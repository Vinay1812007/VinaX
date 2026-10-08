import { useCallback, useEffect, useRef, useState } from 'react';
import { pickSynthVoice } from '@/features/voice/pickSynthVoice';
import { ttsBody } from '../readAloud';
import { DEVICE_VOICE, parseVoicePick } from '../voicePick';
import { TTS_ENDPOINT } from './endpoints';

/**
 * 11.2 — a short sample of one voice, played on request and never on its own.
 *
 * One sample plays at a time: starting another stops the first, and tapping
 * the playing one again stops it. A studio voice's sample is fetched once per
 * session and kept as an object URL (revoked when the picker closes), so
 * hearing it again costs no request. The device voice is sampled through the
 * browser's own speech engine.
 */
export type PreviewStatus = 'idle' | 'loading' | 'playing';

export interface VoicePreview {
  /** The voice key ('device' or provider|model|voice) being fetched or played. */
  active: string | null;
  status: PreviewStatus;
  /** Last failure per voice key, shown on that voice until it is tried again. */
  errors: Readonly<Record<string, string>>;
  toggle: (key: string, name: string) => void;
  stop: () => void;
}

export const previewLine = (name: string): string => `Hi, I'm ${name}. This is how I sound in VinaX.`;

export const PREVIEW_QUOTA = 'Out of quota right now — try this voice later.';
export const PREVIEW_FAILED = 'This voice isn’t answering right now.';
export const PREVIEW_NO_PLAY = 'This sample couldn’t play on this device.';
/** A sample is a dozen words; a voice that needs longer than this is down. */
const PREVIEW_LEASH_MS = 20_000;

export function useVoicePreview(): VoicePreview {
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const fetches = useRef(new Set<AbortController>());
  const token = useRef(0);
  const activeRef = useRef<string | null>(null);
  const mounted = useRef(true);

  const setError = useCallback((key: string, msg: string): void => {
    setErrors((e) => (msg ? { ...e, [key]: msg } : Object.fromEntries(Object.entries(e).filter(([k]) => k !== key))));
  }, []);

  const settle = useCallback((t: number): void => {
    if (t !== token.current || !mounted.current) return;
    activeRef.current = null;
    setActive(null);
    setStatus('idle');
  }, []);

  const halt = useCallback((): void => {
    token.current += 1;
    const el = audio.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    if (activeRef.current === DEVICE_VOICE) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* no synthesis */
      }
    }
  }, []);

  const stop = useCallback((): void => {
    halt();
    activeRef.current = null;
    setActive(null);
    setStatus('idle');
  }, [halt]);

  const playUrl = useCallback(
    (key: string, url: string, t: number): void => {
      let el = audio.current;
      if (!el) {
        try {
          el = new Audio();
        } catch {
          el = null;
        }
        audio.current = el;
      }
      if (!el) {
        setError(key, PREVIEW_NO_PLAY);
        settle(t);
        return;
      }
      el.onended = () => settle(t);
      el.onerror = () => {
        if (t !== token.current) return;
        setError(key, PREVIEW_NO_PLAY);
        settle(t);
      };
      el.src = url;
      setStatus('playing');
      try {
        void Promise.resolve(el.play()).catch(() => {
          if (t !== token.current) return;
          setError(key, PREVIEW_NO_PLAY);
          settle(t);
        });
      } catch {
        setError(key, PREVIEW_NO_PLAY);
        settle(t);
      }
    },
    [setError, settle],
  );

  const toggle = useCallback(
    (key: string, name: string): void => {
      const same = activeRef.current === key;
      halt();
      if (same) {
        activeRef.current = null;
        setActive(null);
        setStatus('idle');
        return;
      }
      const t = token.current;
      activeRef.current = key;
      setActive(key);
      setError(key, '');
      const line = previewLine(name);

      if (key === DEVICE_VOICE) {
        try {
          const u = new SpeechSynthesisUtterance(line);
          const v = pickSynthVoice('en-IN');
          if (v) u.voice = v;
          u.lang = v?.lang || 'en-IN';
          u.onend = () => settle(t);
          u.onerror = () => {
            if (t !== token.current) return;
            setError(key, PREVIEW_NO_PLAY);
            settle(t);
          };
          setStatus('playing');
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch {
          setError(key, PREVIEW_NO_PLAY);
          settle(t);
        }
        return;
      }

      const cached = cache.current.get(key);
      if (cached) {
        playUrl(key, cached, t);
        return;
      }
      const pick = parseVoicePick(key);
      if (!pick || typeof fetch !== 'function') {
        setError(key, PREVIEW_FAILED);
        settle(t);
        return;
      }
      setStatus('loading');
      const ctrl = new AbortController();
      fetches.current.add(ctrl);
      const timer = window.setTimeout(() => ctrl.abort(), PREVIEW_LEASH_MS);
      void fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ttsBody(line, pick)),
        signal: ctrl.signal,
      })
        .then(async (res): Promise<string | Blob> => {
          if (res.status === 429) return PREVIEW_QUOTA;
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio/')) return PREVIEW_FAILED;
          const b = await res.blob();
          return b.size > 0 ? b : PREVIEW_FAILED;
        })
        .catch(() => PREVIEW_FAILED)
        .then((out) => {
          if (!mounted.current) return;
          if (typeof out === 'string') {
            // A newer tap owns the button now; the failure still belongs to this voice.
            setError(key, out);
            settle(t);
            return;
          }
          let url: string;
          try {
            url = URL.createObjectURL(out);
          } catch {
            setError(key, PREVIEW_NO_PLAY);
            settle(t);
            return;
          }
          // Kept even when another voice was tapped meanwhile: hearing this
          // one later is then free.
          cache.current.set(key, url);
          if (t === token.current) playUrl(key, url, t);
        })
        .finally(() => {
          window.clearTimeout(timer);
          fetches.current.delete(ctrl);
        });
    },
    [halt, playUrl, setError, settle],
  );

  useEffect(() => {
    mounted.current = true;
    const urls = cache.current;
    const inflight = fetches.current;
    return () => {
      mounted.current = false;
      halt();
      for (const c of inflight) c.abort();
      inflight.clear();
      for (const u of urls.values()) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
      urls.clear();
    };
  }, [halt]);

  return { active, status, errors, toggle, stop };
}
