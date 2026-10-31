/**
 * VinaX AI — dictation: the composer's mic. Tap to record (music pauses),
 * tap ✓ to finish; the clip goes to POST /api/ai/transcribe and the text
 * lands in the composer for the listener to read and fix. It is never sent
 * on its own (speech-to-text mishears: "Say OK" came back "Stay okay").
 *
 * The mic is the one picked in Settings, else a real one (mic.ts). A clip
 * that held no sound at all is not uploaded: the listener is told which mic
 * was silent and where to pick another. In the Android app, when the page
 * may not use the mic (an app installed before the permission it needs was
 * added), the phone's own speech recogniser takes the dictation instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSttSession, type SttSession } from '@/features/voice/stt';
import { isNativePlatform } from '@/services/native';
import { AiError, transcribeClip, voiceNotice } from './api';
import { closeMic, MicError, micLabelOf, micNotice, micSupported, newAudioContext, openMic, recordClip, silentMicNotice, type Recording } from './mic';
import { holdMusic } from './musicHold';
import { usePrefs } from './prefs';

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface Dictation {
  phase: DictationPhase;
  /** Seconds recorded so far. */
  seconds: number;
  /** Loudness now, 0–1. */
  level: number;
  /** Recording, but no sound has arrived from the mic for a while. */
  silent: boolean;
  notice: string | null;
  /** The notice is about the mic: offer the mic setting. */
  noticeIsMic: boolean;
  supported: boolean;
  start(): void;
  finish(): void;
  cancel(): void;
  dismiss(): void;
}

/** How long a mic may give pure silence before the bar says so. */
const SILENT_AFTER_MS = 1_800;

interface Session {
  stream: MediaStream | null;
  rec: Recording | null;
  native: SttSession | null;
  nativeText: string;
  ctx: AudioContext | null;
  release: () => void;
  tick: number;
  started: number;
  abort: AbortController;
}

export function useVoiceDictation(onText: (text: string) => void): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const [notice, setNoticeState] = useState<{ text: string; mic: boolean } | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const session = useRef<Session | null>(null);
  const setNotice = (text: string | null, mic = false) => setNoticeState(text ? { text, mic } : null);

  const end = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    window.clearInterval(s.tick);
    closeMic(s.stream);
    void s.ctx?.close().catch(() => undefined);
    s.release();
    setLevel(0);
    setSilent(false);
  }, []);

  const cancel = useCallback(() => {
    session.current?.abort.abort();
    session.current?.rec?.cancel();
    session.current?.native?.abort();
    end();
    setPhase('idle');
  }, [end]);

  const finish = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.native) {
      // The phone's recogniser: its last words arrive through onEnd.
      setPhase('transcribing');
      s.native.stop();
      return;
    }
    if (!s.rec) return;
    const rec = s.rec;
    s.rec = null;
    window.clearInterval(s.tick);
    setPhase('transcribing');
    void (async () => {
      const heard = rec.heard();
      const label = micLabelOf(s.stream);
      const clip = await rec.stop();
      closeMic(s.stream);
      s.stream = null;
      // Music may come back while the text is read: the mic is closed.
      s.release();
      s.release = () => undefined;
      if (!heard) {
        end();
        setPhase('idle');
        setNotice(silentMicNotice(label), true);
        return;
      }
      if (Date.now() - s.started < 400 || clip.size < 200) {
        end();
        setPhase('idle');
        setNotice('Hold on a little longer: that was too short to hear.');
        return;
      }
      try {
        const text = await transcribeClip(clip, s.abort.signal);
        if (s.abort.signal.aborted) return;
        if (text.trim() && !/^[\s.…,!?-]*$/.test(text)) onTextRef.current(text.trim());
        else setNotice('Nothing was heard. Try again a little closer to the mic.', true);
      } catch (e) {
        if (s.abort.signal.aborted) return;
        setNotice(voiceNotice(e instanceof AiError ? e.code : 'voice_unavailable'));
      }
      end();
      setPhase('idle');
    })();
  }, [end]);

  /** The Android app may not hand the page the mic: dictate with the phone's recogniser. */
  const startNative = useCallback((s: Session): boolean => {
    const native = createSttSession({ lang: navigator.language || 'en-US' }, {
      onAudioStart: () => setPhase('recording'),
      onInterim: (text) => {
        s.nativeText = text;
        // No audio to measure: a gentle pulse while words arrive.
        setLevel(0.35 + 0.3 * Math.random());
      },
      onEnd: (finalText, fatal) => {
        if (session.current !== s) return;
        const text = (finalText || s.nativeText).trim();
        end();
        setPhase('idle');
        if (text) onTextRef.current(text);
        else if (fatal === 'denied') setNotice(micNotice('denied'), true);
        else setNotice('Nothing was heard. Try again a little closer to the mic.', true);
      },
    });
    if (!native) return false;
    s.native = native;
    s.started = Date.now();
    s.tick = window.setInterval(() => setSeconds(Math.floor((Date.now() - s.started) / 1000)), 250);
    setPhase('recording');
    return true;
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
    setSilent(false);
    // Made inside the tap, so the meter's audio runs on every browser.
    const ctx = newAudioContext();
    const s: Session = { stream: null, rec: null, native: null, nativeText: '', ctx, release: holdMusic('pause'), tick: 0, started: Date.now(), abort: new AbortController() };
    session.current = s;
    void openMic(usePrefs.getState().micId)
      .then((stream) => {
        if (session.current !== s) { closeMic(stream); return; }
        s.stream = stream;
        s.rec = recordClip(stream, () => finish(), ctx);
        s.started = Date.now();
        s.tick = window.setInterval(() => {
          const rec = s.rec;
          if (!rec) return;
          setSeconds(Math.floor((Date.now() - s.started) / 1000));
          setLevel(rec.level());
          setSilent(!rec.heard() && Date.now() - s.started > SILENT_AFTER_MS);
        }, 100);
        setPhase('recording');
      })
      .catch((e: unknown) => {
        if (session.current !== s) return;
        const problem = e instanceof MicError ? e.problem : 'unsupported';
        if (problem === 'denied' && isNativePlatform() && startNative(s)) return;
        end();
        setPhase('idle');
        setNotice(micNotice(problem), true);
      });
  }, [end, finish, startNative]);

  // Leaving the page stops the mic.
  useEffect(() => () => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    s.abort.abort();
    s.rec?.cancel();
    s.native?.abort();
    window.clearInterval(s.tick);
    closeMic(s.stream);
    void s.ctx?.close().catch(() => undefined);
    s.release();
  }, []);

  return {
    phase, seconds, level, silent,
    notice: notice?.text ?? null,
    noticeIsMic: !!notice?.mic,
    supported: micSupported(),
    start, finish, cancel,
    dismiss: () => setNotice(null),
  };
}
