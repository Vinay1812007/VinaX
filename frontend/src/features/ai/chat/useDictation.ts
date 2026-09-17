import { useCallback, useEffect, useRef, useState } from 'react';
import { localRecognitionState, prepareLocalRecognition } from '@/features/voice/liveVoiceEngine';
import { createSttSession, sttSupported, type SttSession } from '@/features/voice/stt';

/**
 * Voice input for the composer (the mic button): speech becomes text in the
 * box. Extracted from the page in v7.1 — behaviour unchanged, including the
 * on-device retry when the speech service ends instantly and the 8-second
 * watchdog that turns an eternal "Listening…" into an honest message.
 */
export function useDictation(onText: (text: string) => void): {
  listening: boolean;
  note: string;
  start: () => void;
  stop: () => void;
} {
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const recRef = useRef<SttSession | null>(null);
  const watchdogRef = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const clearWatchdog = (): void => {
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = 0;
    }
  };

  const start = useCallback((): void => {
    if (!sttSupported()) {
      setNote('Voice input isn’t supported here — try a current desktop browser, or the VinaX app.');
      return;
    }
    // Inside the tap: get the on-device route ready (a model install needs
    // the gesture) — the fallback that keeps working when the server route is
    // dead. (Web only — a harmless no-op on native, where the plugin listens.)
    prepareLocalRecognition('en-IN');
    setNote('');
    recRef.current?.abort();
    recRef.current = null;
    const attempt = (useLocal: boolean, retried: boolean): void => {
      const startedAt = Date.now();
      let sawAudio = false;
      let gotAnyResult = false;
      const session = createSttSession(
        { lang: 'en-IN', processLocally: useLocal },
        {
          onAudioStart: () => {
            sawAudio = true;
          },
          onInterim: (t) => {
            gotAnyResult = true;
            clearWatchdog();
            setNote('');
            onTextRef.current(t);
          },
          onEnd: (finalText, fatal) => {
            clearWatchdog();
            if (recRef.current !== session) return;
            recRef.current = null;
            const said = finalText.trim();
            if (fatal) {
              setNote(
                fatal === 'denied'
                  ? 'Microphone access is blocked — allow the mic for VinaX, then try again.'
                  : 'Voice input didn’t start — try again in a moment.',
              );
            } else if (!said && !sawAudio && Date.now() - startedAt < 1500) {
              // Instant silent end = dead speech service (diagnosed live): retry
              // once on the on-device route, otherwise say what's wrong.
              if (!retried && !useLocal && localRecognitionState() === 'ready') {
                attempt(true, true);
                return;
              }
              setNote(
                localRecognitionState() === 'installing' || localRecognitionState() === 'checking'
                  ? 'Preparing voice input (one-time download) — try again in a moment.'
                  : 'Mic input didn’t start — check microphone permission for VinaX.',
              );
            } else if (!said && sawAudio && !gotAnyResult) {
              // Audio flowed for the whole window but no result ever came —
              // the speech service is silent. Tell the listener honestly.
              setNote('Voice input didn’t hear anything — check the mic and try again.');
            }
            setListening(false);
          },
        },
      );
      if (!session) {
        setListening(false);
        setNote('Voice input didn’t start — try again in a moment.');
        return;
      }
      recRef.current = session;
      setListening(true);
      // Silent-service watchdog: no result for 8s → stop gracefully so onEnd
      // surfaces an honest message instead of an eternal "Listening…".
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        if (recRef.current !== session || gotAnyResult) return;
        session.stop();
      }, 8000);
    };
    attempt(localRecognitionState() === 'ready', false);
  }, []);

  const stop = useCallback((): void => {
    recRef.current?.stop();
    clearWatchdog();
    setListening(false);
  }, []);

  useEffect(
    () => () => {
      clearWatchdog();
      recRef.current?.abort();
      recRef.current = null;
    },
    [],
  );

  return { listening, note, start, stop };
}
