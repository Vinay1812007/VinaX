/**
 * VinaX AI Live voice — the pieces of Gemini Live's WebSocket protocol the
 * page needs, kept free of the browser so they can be tested:
 *
 *   page → Gemini   { setup }  (from POST /api/ai/live-token, sent first)
 *                   { realtimeInput: { audio: { data: <base64 PCM>, mimeType: "audio/pcm;rate=16000" } } }
 *                   { realtimeInput: { audioStreamEnd: true } }   (mic muted)
 *   Gemini → page   { setupComplete }
 *                   { serverContent: { modelTurn: { parts: [{ inlineData: { data } }] },
 *                                      inputTranscription: { text }, outputTranscription: { text },
 *                                      interrupted, turnComplete } }
 *                   { goAway: { timeLeft } }
 *
 * Mic audio goes as 16-bit PCM at 16 kHz; Gemini's voice comes back as
 * 16-bit PCM at 24 kHz. Shapes checked against Google's Live API reference
 * (2026-10-31); see docs/ai.md.
 */

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
export const INPUT_MIME = `audio/pcm;rate=${INPUT_RATE}`;

/** Linear-interpolation resampler that keeps its place across batches. */
export class Resampler {
  private pos = 0;
  private last = 0;

  constructor(private readonly from: number, private readonly to = INPUT_RATE) {}

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input.slice();
    const step = this.from / this.to;
    const out: number[] = [];
    // `pos` is where the next output sample falls, in input samples, where
    // -1 is the previous batch's last sample.
    while (this.pos < input.length - 1 + 1e-9) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : input[i];
      const b = input[Math.min(input.length - 1, i + 1)];
      out.push(a + (b - a) * frac);
      this.pos += step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1] ?? this.last;
    return Float32Array.from(out);
  }
}

/** Floats (−1…1) to little-endian 16-bit PCM bytes. */
export function floatTo16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Loudness of a batch, 0–1 (for the orb). */
export function levelOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

export const audioMessage = (pcm: Uint8Array): string => JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(pcm), mimeType: INPUT_MIME } } });
export const streamEndMessage = (): string => JSON.stringify({ realtimeInput: { audioStreamEnd: true } });

export type LiveEvent =
  | { type: 'ready' }
  | { type: 'audio'; data: string }
  | { type: 'heard'; text: string }
  | { type: 'said'; text: string }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'goAway' };

/** One server message as the events the page acts on (unknown parts are ignored). */
export function parseServerMessage(raw: string): LiveEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!m || typeof m !== 'object') return [];
  const out: LiveEvent[] = [];
  if ('setupComplete' in m) out.push({ type: 'ready' });
  const sc = m.serverContent as Record<string, unknown> | undefined;
  if (sc && typeof sc === 'object') {
    const heard = (sc.inputTranscription as { text?: unknown } | undefined)?.text;
    if (typeof heard === 'string' && heard) out.push({ type: 'heard', text: heard });
    const parts = ((sc.modelTurn as { parts?: unknown } | undefined)?.parts ?? []) as Array<{ inlineData?: { data?: unknown } }>;
    if (Array.isArray(parts)) for (const p of parts) if (typeof p?.inlineData?.data === 'string') out.push({ type: 'audio', data: p.inlineData.data });
    const said = (sc.outputTranscription as { text?: unknown } | undefined)?.text;
    if (typeof said === 'string' && said) out.push({ type: 'said', text: said });
    if (sc.interrupted === true) out.push({ type: 'interrupted' });
    if (sc.turnComplete === true) out.push({ type: 'turnComplete' });
  }
  if ('goAway' in m) out.push({ type: 'goAway' });
  return out;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * The session's transcript, exchange by exchange. Transcription arrives in
 * small pieces and the listener's words can land after the model has
 * started answering, so each exchange keeps both sides until it completes.
 */
export class Transcript {
  private exchanges: Array<{ user: string; assistant: string; done: boolean }> = [];

  private current() {
    let last = this.exchanges[this.exchanges.length - 1];
    if (!last || last.done) {
      last = { user: '', assistant: '', done: false };
      this.exchanges.push(last);
    }
    return last;
  }

  heard(text: string): void {
    this.current().user += text;
  }

  said(text: string): void {
    this.current().assistant += text;
  }

  complete(): void {
    const last = this.exchanges[this.exchanges.length - 1];
    if (last) last.done = true;
  }

  /** What is being said now (for the captions). */
  now(): { user: string; assistant: string } {
    const last = this.exchanges[this.exchanges.length - 1];
    return last && !last.done ? { user: tidy(last.user), assistant: tidy(last.assistant) } : { user: '', assistant: '' };
  }

  /** Everything said, as chat turns (empty sides left out). */
  turns(): Turn[] {
    const out: Turn[] = [];
    for (const e of this.exchanges) {
      if (tidy(e.user)) out.push({ role: 'user', text: tidy(e.user) });
      if (tidy(e.assistant)) out.push({ role: 'assistant', text: tidy(e.assistant) });
    }
    return out;
  }
}

const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();
