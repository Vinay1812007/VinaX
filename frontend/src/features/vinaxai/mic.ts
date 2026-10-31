/**
 * VinaX AI — the microphone, for dictation (a recorded clip) and Live voice
 * (a stream). In the Android app the system permission prompt is the one
 * voice search uses; the page then opens the mic itself.
 *
 * Which mic: the one picked in VinaX AI Settings, else the browser's. When
 * nothing was picked and the browser's mic is a virtual device (BlackHole,
 * Loopback, a remote-desktop or meeting app's driver…), a real one is used
 * instead: virtual devices usually carry no sound, so the listener spoke
 * and nothing moved and nothing was heard.
 */
import { nativeMicPermission } from '@/features/voice/stt';
import { isNativePlatform } from '@/services/native';

export type MicProblem = 'unsupported' | 'denied' | 'no_mic' | 'busy';

export class MicError extends Error {
  constructor(readonly problem: MicProblem) {
    super(problem);
  }
}

export const micSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && 'MediaRecorder' in window;

/** What to tell the listener when the mic would not open. */
export function micNotice(problem: MicProblem): string {
  switch (problem) {
    case 'denied':
      return isNativePlatform()
        ? 'VinaX can’t use your microphone. Allow it for VinaX in your phone’s settings, and update the app if it asks.'
        : 'VinaX AI can’t use your microphone. Allow it in your browser’s site settings, then try again.';
    case 'no_mic': return 'No microphone was found.';
    case 'busy': return 'Your microphone is in use by another app.';
    default: return 'Voice isn’t supported here. Try a current browser or the VinaX app.';
  }
}

/** What to say when the mic gave pure silence (a muted or virtual device). */
export const silentMicNotice = (label: string, next = 'Pick another microphone in VinaX AI settings.'): string =>
  `No sound is reaching VinaX AI${label ? ` from “${label}”` : ''}. ${next}`;

// ---------- devices ----------

export interface MicDevice {
  deviceId: string;
  label: string;
  virtual: boolean;
}

/**
 * Audio drivers that are not microphones: loopback and routing devices,
 * remote-desktop and meeting-app drivers, phone-as-webcam apps. Noise
 * cancellers (Krisp, NVIDIA Broadcast) pass a real mic through, so they are
 * not on the list.
 */
const VIRTUAL = /blackhole|soundflower|loopback|\bvirtual\b|vb-?audio|vb-?cable|cable output|voicemeeter|remotepc|aggregate device|multi-output|zoomaudio|zoom audio device|teams audio|microsoft teams audio|droidcam|iriun|camo\b|obs\b|background music|soundsource|audio hijack/i;

export const isVirtualMic = (label: string): boolean => VIRTUAL.test(label);

/** Chrome lists the system default twice: as "Default - X" (id "default") and as X. */
const DEFAULT_PREFIX = /^(default|communications)\s*-\s*/i;
export const cleanMicLabel = (label: string): string => label.replace(DEFAULT_PREFIX, '').trim();

/** This device's microphones (labels appear once mic access was granted). */
export async function listMics(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label, virtual: isVirtualMic(d.label) }));
  } catch {
    return [];
  }
}

/**
 * The best real mic to use instead of a virtual one: the system default when
 * it is real, then a built-in mic, then any real one. Null when there is none.
 */
export function pickRealMic(mics: readonly MicDevice[], skip: string | null = null): MicDevice | null {
  const real = mics.filter((m) => !m.virtual && m.label && m.deviceId !== skip);
  return real.find((m) => m.deviceId === 'default')
    ?? real.find((m) => m.deviceId === 'communications')
    ?? real.find((m) => /built-?in|internal|macbook|headset|airpods|buds/i.test(m.label))
    ?? real[0]
    ?? null;
}

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } as const;

async function getAudio(deviceId: string | null): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...AUDIO, deviceId: { exact: deviceId } } : { ...AUDIO } });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('no_mic');
    if (name === 'NotReadableError' || name === 'AbortError') throw new MicError('busy');
    throw new MicError('unsupported');
  }
}

/** The label of the mic a stream comes from. */
export const micLabelOf = (stream: MediaStream | null): string => cleanMicLabel(stream?.getAudioTracks()[0]?.label ?? '');

/**
 * Open the mic (echo cancellation on, so VinaX AI's own voice is not heard
 * back). `preferred` is the device picked in Settings ('' = automatic); when
 * it is gone, the browser's mic is used.
 */
export async function openMic(preferred = ''): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported');
  if (!(await nativeMicPermission())) throw new MicError('denied');
  if (preferred) {
    try {
      return await getAudio(preferred);
    } catch (e) {
      if (e instanceof MicError && e.problem === 'denied') throw e;
      // The picked mic was unplugged: use the browser's.
    }
  }
  const stream = await getAudio(null);
  if (preferred || !isVirtualMic(stream.getAudioTracks()[0]?.label ?? '')) return stream;
  const track = stream.getAudioTracks()[0];
  const better = pickRealMic(await listMics(), track?.getSettings?.().deviceId ?? null);
  if (!better) return stream;
  closeMic(stream);
  try {
    return await getAudio(better.deviceId);
  } catch {
    return getAudio(null);
  }
}

export const closeMic = (stream: MediaStream | null): void => {
  for (const t of stream?.getTracks() ?? []) t.stop();
};

// ---------- levels ----------

/**
 * Loudness for the meters, 0–1, on a decibel scale: a quiet room sits near
 * 0, ordinary speech fills half to most of it. (A straight RMS scale barely
 * moved for speech, so the meters looked dead.)
 */
export function loudness(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 58) / 46));
}

/** RMS of a batch of samples. */
export function rmsOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** True when any sample is not exactly zero (a real mic always has some noise). */
export function hasSignal(samples: Float32Array): boolean {
  for (const s of samples) if (s !== 0) return true;
  return false;
}

/** The audio context to use (created inside the tap, so it may run on every browser). */
export function newAudioContext(sampleRate?: number): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = sampleRate ? new AC({ sampleRate }) : new AC();
    void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Connect a mic stream to a context. Firefox refuses a stream whose sample
 * rate differs from the context's (a Bluetooth headset at 16 kHz with
 * speakers at 48 kHz); then a context at the mic's rate is made.
 */
export function micSource(ctx: AudioContext, stream: MediaStream): { ctx: AudioContext; source: MediaStreamAudioSourceNode } {
  try {
    return { ctx, source: ctx.createMediaStreamSource(stream) };
  } catch (e) {
    const rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
    const other = rate && rate !== ctx.sampleRate ? newAudioContext(rate) : null;
    if (!other) throw e;
    return { ctx: other, source: other.createMediaStreamSource(stream) };
  }
}

/** Watches a mic: its loudness now, and whether any sound arrived at all. */
export interface MicWatch {
  level(): number;
  /** Any non-zero sample since the watch began. */
  heard(): boolean;
  stop(): void;
}

export function watchMic(stream: MediaStream, ctx: AudioContext | null): MicWatch {
  let analyser: AnalyserNode | null = null;
  let own: AudioContext | null = null;
  let running: AudioContext | null = null;
  try {
    const base = ctx ?? newAudioContext();
    if (base) {
      const { ctx: used, source } = micSource(base, stream);
      running = used;
      if (used !== base || !ctx) own = used;
      void used.resume().catch(() => undefined);
      analyser = used.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    }
  } catch {
    analyser = null;
  }
  const buf = new Float32Array(1024);
  let heard = false;
  let smooth = 0;
  /** Reads taken while the audio actually ran: a suspended context reads zeros, which proves nothing. */
  let checks = 0;
  return {
    level: () => {
      if (!analyser || running?.state !== 'running') return 0;
      checks += 1;
      analyser.getFloatTimeDomainData(buf);
      if (!heard && hasSignal(buf)) heard = true;
      const now = loudness(rmsOf(buf));
      // Rise at once, fall gently: the meter follows the voice without flicker.
      smooth = now > smooth ? now : smooth * 0.7 + now * 0.3;
      return smooth;
    },
    // Without enough real reads the page cannot tell, so it assumes sound arrived.
    heard: () => heard || !analyser || checks < 5,
    stop: () => {
      try { analyser?.disconnect(); } catch { /* gone */ }
      void own?.close().catch(() => undefined);
    },
  };
}

// ---------- dictation clips ----------

/** The clip format this browser records that the speech-to-text service reads. */
export function clipType(): string {
  const R = (window as unknown as { MediaRecorder?: { isTypeSupported?(t: string): boolean } }).MediaRecorder;
  const want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return want.find((t) => R?.isTypeSupported?.(t)) ?? '';
}

/** The longest dictation clip. */
export const MAX_CLIP_MS = 120_000;

export interface Recording {
  /** Finish and get the clip. */
  stop(): Promise<Blob>;
  /** Drop the clip. */
  cancel(): void;
  /** Loudness now, 0–1 (for the meter). */
  level(): number;
  /** Whether any sound has arrived from the mic. */
  heard(): boolean;
}

/**
 * Record one clip from an open mic. Stops by itself after MAX_CLIP_MS
 * (`onLimit`). `ctx` is an audio context made inside the tap, for the meter.
 */
export function recordClip(stream: MediaStream, onLimit: () => void, ctx: AudioContext | null = null): Recording {
  const type = clipType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1_000);
  const limit = window.setTimeout(onLimit, MAX_CLIP_MS);
  const watch = watchMic(stream, ctx);
  const done = () => {
    window.clearTimeout(limit);
    watch.stop();
  };
  return {
    stop: () => new Promise<Blob>((resolve) => {
      done();
      if (rec.state === 'inactive') { resolve(new Blob(parts, { type: rec.mimeType || type })); return; }
      rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || type }));
      rec.stop();
    }),
    cancel: () => {
      done();
      rec.ondataavailable = null;
      if (rec.state !== 'inactive') rec.stop();
    },
    level: () => watch.level(),
    heard: () => watch.heard(),
  };
}
