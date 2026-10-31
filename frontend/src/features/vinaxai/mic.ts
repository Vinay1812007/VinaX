/**
 * VinaX AI — the microphone, for dictation (a recorded clip) and Live voice
 * (a stream). In the Android app the system permission prompt is the one
 * voice search uses; the page then opens the mic itself.
 */
import { nativeMicPermission } from '@/features/voice/stt';

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
    case 'denied': return 'VinaX AI can’t use your microphone. Allow it in your browser or phone settings, then try again.';
    case 'no_mic': return 'No microphone was found.';
    case 'busy': return 'Your microphone is in use by another app.';
    default: return 'Voice isn’t supported here. Try a current browser or the VinaX app.';
  }
}

/** Open the mic (echo cancellation on, so VinaX AI's own voice is not heard back). */
export async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported');
  if (!(await nativeMicPermission())) throw new MicError('denied');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('no_mic');
    if (name === 'NotReadableError' || name === 'AbortError') throw new MicError('busy');
    throw new MicError('unsupported');
  }
}

export const closeMic = (stream: MediaStream | null): void => {
  for (const t of stream?.getTracks() ?? []) t.stop();
};

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
}

/** Record one clip from an open mic. Stops by itself after MAX_CLIP_MS (`onLimit`). */
export function recordClip(stream: MediaStream, onLimit: () => void): Recording {
  const type = clipType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1_000);
  const limit = window.setTimeout(onLimit, MAX_CLIP_MS);

  // A level meter that never blocks recording when Web Audio is missing.
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
    }
  } catch {
    analyser = null;
  }
  const buf = new Uint8Array(512);
  const done = () => {
    window.clearTimeout(limit);
    void ctx?.close().catch(() => undefined);
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
    level: () => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 64);
    },
  };
}
