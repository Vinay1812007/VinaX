/**
 * VinaX AI — reading POST /api/ai/speak's stream and turning it into
 * sound. The stream is a run of frames, [kind 1 byte][length 4 bytes BE]
 * [payload]: 1 = an audio file ("<mime>\n" + bytes), 2 = base64 audio
 * ("<mime>\n<base64>"), 3 = stopped ({"error"}). See the route's header.
 *
 * WAV and raw 16-bit PCM are decoded here (Gemini's WAV header may carry
 * a streaming length, which some decoders refuse); anything else goes to
 * the browser's decoder.
 */
export const FRAME_FILE = 1;
export const FRAME_BASE64 = 2;
export const FRAME_STOPPED = 3;

export type SpeechFrame =
  | { kind: 'audio'; mime: string; bytes: Uint8Array }
  | { kind: 'stopped'; error: string };

const dec = new TextDecoder();

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Splits the byte stream into frames as bytes arrive (frames may span reads). */
export class FrameReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): SpeechFrame[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: SpeechFrame[] = [];
    while (this.buf.length >= 5) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + 1, 4).getUint32(0);
      if (this.buf.length < 5 + len) break;
      const kind = this.buf[0];
      const payload = this.buf.slice(5, 5 + len);
      this.buf = this.buf.slice(5 + len);
      const f = toFrame(kind, payload);
      if (f) out.push(f);
    }
    return out;
  }
}

function toFrame(kind: number, payload: Uint8Array): SpeechFrame | null {
  if (kind === FRAME_FILE) {
    const nl = payload.indexOf(10);
    return { kind: 'audio', mime: dec.decode(payload.slice(0, Math.max(0, nl))), bytes: payload.slice(nl + 1) };
  }
  if (kind === FRAME_BASE64) {
    const text = dec.decode(payload);
    const nl = text.indexOf('\n');
    try {
      return { kind: 'audio', mime: text.slice(0, nl), bytes: base64ToBytes(text.slice(nl + 1)) };
    } catch {
      return null;
    }
  }
  if (kind === FRAME_STOPPED) {
    let error = 'voice_unavailable';
    try { error = String((JSON.parse(dec.decode(payload)) as { error?: unknown }).error ?? error); } catch { /* keep the default */ }
    return { kind: 'stopped', error };
  }
  return null;
}

export interface Pcm {
  rate: number;
  channels: number;
  /** Samples, interleaved, -1…1. */
  samples: Float32Array;
}

/** Raw little-endian 16-bit PCM to floats. */
export function pcm16(bytes: Uint8Array, rate: number, channels = 1): Pcm {
  const n = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { rate, channels, samples };
}

/** A 16-bit PCM WAV file read by hand; null for any other kind of file. */
export function parseWav(bytes: Uint8Array): Pcm | null {
  const ascii = (at: number, len: number) => String.fromCharCode(...bytes.slice(at, at + len));
  if (bytes.length < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let at = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (at + 8 <= bytes.length) {
    const id = ascii(at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      fmt = { format: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) return null;
      // A streamed WAV says 0 or 0xFFFFFFFF here: read to the end.
      const end = size === 0 || size === 0xffffffff || at + 8 + size > bytes.length ? bytes.length : at + 8 + size;
      return pcm16(bytes.slice(at + 8, end), fmt.rate, fmt.channels);
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** A frame's audio as a buffer for this AudioContext. */
export async function toAudioBuffer(ctx: BaseAudioContext, mime: string, bytes: Uint8Array): Promise<AudioBuffer> {
  let pcm = parseWav(bytes);
  if (!pcm && /l16|pcm/i.test(mime)) pcm = pcm16(bytes, Number(/rate=(\d+)/i.exec(mime)?.[1] ?? 24000));
  if (pcm) {
    const frames = Math.floor(pcm.samples.length / pcm.channels);
    const buf = ctx.createBuffer(pcm.channels, Math.max(1, frames), pcm.rate);
    for (let c = 0; c < pcm.channels; c += 1) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < frames; i += 1) ch[i] = pcm.samples[i * pcm.channels + c];
    }
    return buf;
  }
  return ctx.decodeAudioData(bytes.slice().buffer);
}
