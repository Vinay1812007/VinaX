/**
 * 11.3.1 — one spoken turn, heard through VinaX's own speech-to-text.
 *
 * The browser's built-in recognizer (./stt.ts) depends on a speech service
 * behind the browser; on the owner's desktop Chrome it took the microphone,
 * received audio and never returned a word ("didn't hear anything"), so live
 * voice chat and the mic both failed. This records the listener with the
 * page's own microphone stream instead and hands the clip to a transcriber
 * (POST /api/transcribe), the way server-side voice assistants work:
 *
 *   - a recorder runs from the moment the turn opens;
 *   - the microphone level (`getLevel`, 0–1 RMS) tells speech from silence
 *     against a floor learnt from the room: speech starts after ~150 ms
 *     above it, and the turn ends after `silenceMs` of quiet once speech was
 *     heard (or at `maxMs`);
 *   - no speech within `noSpeechMs` ends the turn with '' and nothing is sent;
 *   - the clip goes to `transcribe`; a failure ends with `failed: true`.
 *
 * Pure of React and of the chat feature: the caller supplies the stream, the
 * level and the transcriber. Returns the same stop/abort handle as ./stt.ts.
 */
import type { SttSession } from './stt';

export interface UtteranceOptions {
  /** The open microphone (echo cancellation on). Not stopped here. */
  stream: MediaStream;
  /** The microphone level right now, 0–1 (RMS of the time-domain signal). */
  getLevel(): number;
  /** Speech-to-text for one clip; null when it failed. */
  transcribe(clip: Blob, signal: AbortSignal): Promise<string | null>;
  /** Quiet after speech that ends the turn. */
  silenceMs?: number;
  /** Longest turn. */
  maxMs?: number;
  /** Give up (and send nothing) when no speech starts within this long. */
  noSpeechMs?: number;
}

export interface UtteranceCallbacks {
  /** The listener started talking. */
  onSpeechStart?(): void;
  /** The listener stopped talking: the clip is on its way to be transcribed. */
  onSpeechEnd?(): void;
  /** Fires exactly once, unless aborted: the text ('' = nothing was said),
   *  and whether transcription failed. */
  onEnd(text: string, failed: boolean): void;
}

const TICK_MS = 50;
/** Ticks above the threshold before it counts as speech (~150 ms). */
const SPEECH_TICKS = 3;
/** Absolute floor for the speech threshold (RMS), for very quiet rooms. */
const MIN_THRESHOLD = 0.012;
/** The room's level is never learnt above this: someone already talking when
 *  the turn opens must not become "the room" (speech would never be heard). */
const MAX_FLOOR = 0.03;

/** Phrases speech-to-text models are known to invent from a breath or a
 *  click. Dropped only when the speech itself was very short. */
const PHANTOM = /^(?:thank you\.?|thanks(?: for watching)?[.!]?|you\.?|bye\.?|\.+|okay\.?)$/i;

export function isPhantom(text: string, speechMs: number): boolean {
  return speechMs < 1200 && PHANTOM.test(text.trim());
}

/** The recorder container to ask for, Opus in WebM first ('' = the browser's choice). */
export function utteranceMime(): string {
  const MR = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      /* keep looking */
    }
  }
  return '';
}

/** Recording + a microphone are available (web; not the app, which has its own recognizer). */
export function utteranceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { MediaRecorder?: unknown }).MediaRecorder === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export function recordUtterance(opts: UtteranceOptions, cbs: UtteranceCallbacks): SttSession | null {
  const silenceMs = opts.silenceMs ?? 900;
  const maxMs = opts.maxMs ?? 30_000;
  const noSpeechMs = opts.noSpeechMs ?? 12_000;
  let rec: MediaRecorder;
  try {
    const mimeType = utteranceMime();
    rec = mimeType ? new MediaRecorder(opts.stream, { mimeType }) : new MediaRecorder(opts.stream);
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let floor = -1;
  let above = 0;
  let speechAt = 0;
  let quietSince = 0;
  let ending = false;
  let aborted = false;
  let done = false;
  const ctrl = new AbortController();

  const finish = (text: string, failed: boolean): void => {
    if (done || aborted) return;
    done = true;
    cbs.onEnd(text, failed);
  };

  /** Stop listening; send the clip when speech was heard (`send`). */
  const end = (send: boolean): void => {
    if (ending) return;
    ending = true;
    window.clearInterval(timer);
    const speechMs = speechAt ? Date.now() - speechAt : 0;
    rec.onstop = () => {
      if (aborted) return;
      if (!send || !speechAt) {
        finish('', false);
        return;
      }
      const clip = new Blob(chunks, { type: (rec.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0] });
      if (!clip.size) {
        finish('', false);
        return;
      }
      void opts.transcribe(clip, ctrl.signal).then(
        (text) => {
          if (text === null) finish('', true);
          else finish(isPhantom(text, speechMs) ? '' : text.trim(), false);
        },
        () => finish('', true),
      );
    };
    if (send && speechAt) cbs.onSpeechEnd?.();
    try {
      if (rec.state !== 'inactive') rec.stop();
      else rec.onstop?.(new Event('stop'));
    } catch {
      finish('', false);
    }
  };

  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const timer = window.setInterval(() => {
    if (ending) return;
    const now = Date.now();
    const level = Math.max(0, opts.getLevel());
    // The room's floor: a slow average of the quiet moments, from a low start.
    if (floor < 0) floor = Math.min(level, MAX_FLOOR);
    const threshold = Math.max(MIN_THRESHOLD, floor * 2.5);
    if (level > threshold) {
      above += 1;
      quietSince = 0;
      if (!speechAt && above >= SPEECH_TICKS) {
        speechAt = now;
        cbs.onSpeechStart?.();
      }
    } else {
      above = 0;
      if (!speechAt) floor = Math.min(MAX_FLOOR, floor * 0.9 + level * 0.1);
      else if (!quietSince) quietSince = now;
    }
    if (speechAt && quietSince && now - quietSince >= silenceMs) end(true);
    else if (now - startedAt >= maxMs) end(true);
    else if (!speechAt && now - startedAt >= noSpeechMs) end(false);
  }, TICK_MS);

  try {
    rec.start(250);
  } catch {
    window.clearInterval(timer);
    return null;
  }

  return {
    /** Done talking (a tap): send what was said. */
    stop() {
      end(true);
    },
    abort() {
      aborted = true;
      ctrl.abort();
      window.clearInterval(timer);
      ending = true;
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
