/**
 * VinaX AI — dictation: the composer's mic. Tap to record (music pauses),
 * tap ✓ to finish; the clip goes to POST /api/ai/transcribe and the text
 * lands in the composer for the listener to read and fix. It is never sent
 * on its own (speech-to-text mishears: "Say OK" came back "Stay okay").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiError, transcribeClip, voiceNotice } from './api';
import { closeMic, MicError, micNotice, micSupported, openMic, recordClip, type Recording } from './mic';
import { holdMusic } from './musicHold';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface Dictation {
  phase: DictationPhase;
  /** Seconds recorded so far. */
  seconds: number;
  /** Loudness now, 0–1. */
  level: number;
  notice: string | null;
  supported: boolean;
  start(): void;
  finish(): void;
  cancel(): void;
  dismiss(): void;
}

export function useVoiceDictation(onText: (text: string) => void): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const session = useRef<{ stream: MediaStream | null; rec: Recording | null; release: () => void; tick: number; started: number; abort: AbortController } | null>(null);

  const end = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    window.clearInterval(s.tick);
    closeMic(s.stream);
    s.release();
    setLevel(0);
  }, []);

  const cancel = useCallback(() => {
    session.current?.abort.abort();
    session.current?.rec?.cancel();
    end();
    setPhase('idle');
  }, [end]);

  const finish = useCallback(() => {
    const s = session.current;
    if (!s?.rec) return;
    const rec = s.rec;
    s.rec = null;
    window.clearInterval(s.tick);
    setPhase('transcribing');
    void (async () => {
      const clip = await rec.stop();
      closeMic(s.stream);
      s.stream = null;
      // Music may come back while the text is read: the mic is closed.
      s.release();
      s.release = () => undefined;
      if (Date.now() - s.started < 400 || clip.size < 200) {
        end();
        setPhase('idle');
        setNotice('Hold on a little longer: that was too short to hear.');
        return;
      }
      try {
        const text = await transcribeClip(clip, s.abort.signal);
        if (s.abort.signal.aborted) return;
        if (text.trim()) onTextRef.current(text.trim());
        else setNotice('Nothing was heard. Try again a little closer to the mic.');
      } catch (e) {
        if (s.abort.signal.aborted) return;
        setNotice(voiceNotice(e instanceof AiError ? e.code : 'voice_unavailable'));
      }
      end();
      setPhase('idle');
    })();
  }, [end]);

  const start = useCallback(() => {
    if (session.current) return;
    setNotice(null);
    if (!micSupported()) {
      setNotice(micNotice('unsupported'));
      return;
    }
    setPhase('starting');
    setSeconds(0);
    const s = { stream: null as MediaStream | null, rec: null as Recording | null, release: holdMusic('pause'), tick: 0, started: Date.now(), abort: new AbortController() };
    session.current = s;
    void openMic()
      .then((stream) => {
        if (session.current !== s) { closeMic(stream); return; }
        s.stream = stream;
        s.rec = recordClip(stream, () => finish());
        s.started = Date.now();
        s.tick = window.setInterval(() => {
          setSeconds(Math.floor((Date.now() - s.started) / 1000));
          setLevel(s.rec?.level() ?? 0);
        }, 100);
        setPhase('recording');
      })
      .catch((e: unknown) => {
        if (session.current !== s) return;
        end();
        setPhase('idle');
        setNotice(micNotice(e instanceof MicError ? e.problem : 'unsupported'));
      });
  }, [end, finish]);

  // Leaving the page stops the mic.
  useEffect(() => () => {
    session.current?.abort.abort();
    session.current?.rec?.cancel();
    const s = session.current;
    session.current = null;
    if (s) { window.clearInterval(s.tick); closeMic(s.stream); s.release(); }
  }, []);

  return { phase, seconds, level, notice, supported: micSupported(), start, finish, cancel, dismiss: () => setNotice(null) };
}
