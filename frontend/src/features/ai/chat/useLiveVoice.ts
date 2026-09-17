import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { LiveVoiceEngine } from '@/features/voice/liveVoiceEngine';
import { pickSynthVoice } from '@/features/voice/pickSynthVoice';
import { createVoiceUiStore, type VoiceUiStore } from './liveVoiceStore';

/** Markdown → what should actually be said aloud. */
export const speechForSpoken = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/[#>*_]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '')
    .slice(0, 2000);

export interface LiveVoice {
  /** A live voice chat is running (the overlay is up). */
  active: boolean;
  /** The engine while a chat runs — the page feeds it the streamed reply. */
  engineRef: MutableRefObject<LiveVoiceEngine | null>;
  store: VoiceUiStore;
  levelRef: MutableRefObject<number>;
  waveRef: MutableRefObject<Uint8Array | null>;
  /** Must be called from the tap itself: the mic and speech need the gesture. */
  start: () => void;
  end: () => void;
  interrupt: () => void;
  toggleMute: () => void;
}

/**
 * Live voice chat, extracted from the page in v7.1 — behaviour unchanged.
 * What the listener says arrives through `onUserFinal`; the page sends it like
 * any typed message and feeds the streamed reply back through `engineRef`.
 * Captions and engine state go to a tiny store so the page never re-renders
 * for them.
 */
export function useLiveVoice(opts: {
  getServerVoice: () => { model: string; voice: string } | null;
  onUserFinal: (text: string) => void;
  /** Stop the reply in flight (interrupt, end). */
  onStopReply: () => void;
}): LiveVoice {
  const [active, setActive] = useState(false);
  const store = useRef(createVoiceUiStore()).current;
  const levelRef = useRef(0);
  const waveRef = useRef<Uint8Array | null>(null);
  const engineRef = useRef<LiveVoiceEngine | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const start = useCallback((): void => {
    if (engineRef.current) return;
    store.reset();
    const engine = new LiveVoiceEngine(
      {
        lang: 'en-IN',
        getVoice: () => pickSynthVoice('en-IN'),
        toSpoken: speechForSpoken,
        // Barge-in: interrupt the reply the moment you start talking. Guarded
        // by a grace period + echo filter in the engine. If a specific device
        // ever talks over itself, flip this to false.
        bargeIn: true,
        getServerVoice: () => optsRef.current.getServerVoice(),
      },
      {
        onState: (st) => {
          store.set(st === 'listening' ? { state: st, aiCaption: '' } : { state: st });
          // Defensive re-wire: the overlay must always render THIS engine's bins.
          waveRef.current = engine.waveBins;
        },
        onLevel: (l) => {
          levelRef.current = l;
        },
        onUserInterim: (t) => store.set({ userCaption: t }),
        onUserFinal: (t) => {
          store.set({ userCaption: t });
          optsRef.current.onUserFinal(t);
        },
        onAssistantCaption: (t) => store.set({ aiCaption: t, userCaption: '' }),
        onNotice: (t) => store.set({ notice: t }),
        onFatal: (reason) => {
          store.set({
            error:
              reason === 'denied'
                ? 'Microphone access is blocked — allow the mic for this site, then try again.'
                : reason === 'unsupported'
                  ? 'This browser does not support voice chat — try a current desktop browser.'
                  : reason === 'no-tts'
                    ? 'Speaking isn’t working in this browser — the reply is above, try text mode.'
                    : 'The browser speech service isn’t responding — try again in a moment or type instead.',
          });
          engineRef.current?.destroy();
        },
      },
    );
    engineRef.current = engine;
    setActive(true);
    store.set({ state: 'listening' });
    engine.start();
    // Wire the waveform AFTER start() so the overlay reads the live bins.
    waveRef.current = engine.waveBins;
  }, [store]);

  const end = useCallback((): void => {
    optsRef.current.onStopReply();
    engineRef.current?.destroy();
    engineRef.current = null;
    waveRef.current = null;
    setActive(false);
    store.reset();
  }, [store]);

  const interrupt = useCallback((): void => {
    optsRef.current.onStopReply();
    engineRef.current?.interrupt();
  }, []);

  const toggleMute = useCallback((): void => {
    const muted = !store.get().muted;
    store.set({ muted });
    engineRef.current?.setMuted(muted);
  }, [store]);

  // Leaving the page ends a live voice chat.
  useEffect(
    () => () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    },
    [],
  );

  return { active, engineRef, store, levelRef, waveRef, start, end, interrupt, toggleMute };
}
