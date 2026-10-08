import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe } from './media';
import type { MediaPick } from './types';

/**
 * 10.3 — the composer's mic when a server dictation model is chosen
 * (Settings → Voice → Dictation). 11.3.1 — and by default (Auto): the mic records the listener with the
 * browser's MediaRecorder (Opus in WebM where it can), at most a minute,
 * with a visible timer and a stop button, then sends the recording to
 * POST /api/transcribe and puts the text in the message box.
 *
 * Any failure — no recorder, the mic refused, a recording too large, the
 * route or the model failing, an empty answer — is handed to `onFallback`
 * with a reason, and the composer falls back to this device's dictation.
 * Live voice chat never comes here: it stays on the device recognizer.
 */

/** Longest single recording. */
export const MAX_RECORD_MS = 60_000;

export type ServerDictationFailure = 'unsupported' | 'denied' | 'failed';

export function recorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { MediaRecorder?: unknown }).MediaRecorder === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** The first container the recorder can write, Opus in WebM first. '' lets
 *  the browser choose. */
export function pickRecorderMime(): string {
  const MR = (window as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
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

/** "0:07" */
export const formatClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function useServerDictation(opts: {
  /** The model, or null for Auto (the server's first available). */
  pick: MediaPick | null;
  /** The recognised text (to be added to the box). */
  onText: (text: string) => void;
  onFallback: (why: ServerDictationFailure) => void;
}): {
  /** 'starting' = waiting for the microphone (the permission prompt, a slow
   *  device); nothing is being recorded yet. */
  state: 'idle' | 'starting' | 'recording' | 'sending';
  elapsed: number;
  start: () => void;
  /** Stop recording and send what was said. */
  stop: () => void;
  /** Stop and throw the recording away. */
  cancel: () => void;
} {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef(0);
  const discardRef = useRef(false);
  // 11.0 — the start that is still waiting for its microphone (0 = none).
  // Stop / Cancel clear it, so a stream that arrives afterwards is released
  // instead of quietly starting a recording nobody can see; a second start
  // while one is pending is ignored.
  const startSeq = useRef(0);
  const pendingStart = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const release = (): void => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stop = useCallback((): void => {
    if (pendingStart.current) {
      // Nothing was recorded yet: there is nothing to send.
      pendingStart.current = 0;
      setState('idle');
      return;
    }
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const cancel = useCallback((): void => {
    discardRef.current = true;
    pendingStart.current = 0;
    abortRef.current?.abort();
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      release();
      setState('idle');
    }
  }, []);

  const start = useCallback((): void => {
    const pick = optsRef.current.pick;
    if (!recorderSupported()) {
      optsRef.current.onFallback('unsupported');
      return;
    }
    if (recRef.current || pendingStart.current) return;
    discardRef.current = false;
    const token = ++startSeq.current;
    pendingStart.current = token;
    setElapsed(0);
    setState('starting');
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        if (!alive.current || pendingStart.current !== token) {
          // Stopped, cancelled or unmounted while the mic was opening: let it
          // go. (The state already belongs to whatever happened since.)
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        pendingStart.current = 0;
        setState('recording');
        streamRef.current = stream;
        let rec: MediaRecorder;
        try {
          const mimeType = pickRecorderMime();
          rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
          release();
          setState('idle');
          optsRef.current.onFallback('unsupported');
          return;
        }
        recRef.current = rec;
        const chunks: Blob[] = [];
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          recRef.current = null;
          release();
          if (!alive.current) return;
          if (discardRef.current) {
            setState('idle');
            return;
          }
          const blob = new Blob(chunks, { type: (rec.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0] });
          if (!blob.size) {
            setState('idle');
            optsRef.current.onFallback('failed');
            return;
          }
          setState('sending');
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          void transcribe(blob, pick, { signal: ctrl.signal }).then((text) => {
            if (abortRef.current === ctrl) abortRef.current = null;
            if (!alive.current || ctrl.signal.aborted) return;
            setState('idle');
            if (text) optsRef.current.onText(text);
            else optsRef.current.onFallback('failed');
          });
        };
        const startedAt = Date.now();
        tickRef.current = window.setInterval(() => {
          const ms = Date.now() - startedAt;
          setElapsed(ms);
          if (ms >= MAX_RECORD_MS) stop();
        }, 250);
        try {
          rec.start(1000);
        } catch {
          recRef.current = null;
          release();
          setState('idle');
          optsRef.current.onFallback('unsupported');
        }
      },
      (err: unknown) => {
        if (!alive.current || pendingStart.current !== token) return;
        pendingStart.current = 0;
        setState('idle');
        const name = (err as { name?: string } | null)?.name;
        optsRef.current.onFallback(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      },
    );
  }, [stop]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pendingStart.current = 0;
      discardRef.current = true;
      abortRef.current?.abort();
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      release();
    };
  }, []);

  return { state, elapsed, start, stop, cancel };
}
