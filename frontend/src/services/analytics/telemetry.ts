import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform, platformName } from '@/services/native';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';

/**
 * Privacy-bounded, consent-gated usage telemetry. Nothing is sent unless the
 * listener opted in during onboarding. We send only an anonymous device id, an
 * optional display name, and the current song; coarse geo is added at the edge
 * (never the raw IP). On web the endpoint is same-origin; the native app posts
 * to the deployed function.
 */
const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/events'
  : '/api/events';
const PLATFORM = platformName();
const HEARTBEAT_MS = 25_000;

function deviceId(): string {
  let id = getLocal<string>(KEYS.deviceId, '');
  if (!id) {
    id =
      globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setLocal(KEYS.deviceId, id);
  }
  return id;
}

function consented(): boolean {
  return getLocal<boolean>(KEYS.analyticsConsent, false) === true;
}

interface EventSong {
  id: string;
  title: string;
  artist: string;
  language: string | null;
  image: string;
}

function toEventSong(song: Song | null | undefined): EventSong | undefined {
  if (!song) return undefined;
  return {
    id: song.id,
    title: song.title,
    artist: song.artists[0]?.name ?? song.subtitle,
    language: song.language,
    image: bestImage(song.images, 200),
  };
}

async function send(type: string, song?: Song | null, extra?: Record<string, unknown>): Promise<void> {
  if (!consented()) return;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Explicit consent signal — the edge rejects requests without it so a
        // forged endpoint hit can't add rows to vinax_events without a real
        // user having opted in first (audit finding H12).
        'x-vinax-consent': 'analytics',
      },
      keepalive: true,
      body: JSON.stringify({
        deviceId: deviceId(),
        // H-SRV-6 loop closure: echo the HMAC-signed id the server issued on
        // first contact. Without it the server derives an ip+ua id on EVERY
        // post, so one listener appeared as a fresh "user" after every
        // network/IP change (the admin duplicate-rows bug).
        signed_device_id: getLocal<string>(KEYS.signedDeviceId, '') || undefined,
        name: getLocal<string>(KEYS.userName, '') || undefined,
        type,
        platform: PLATFORM,
        appVersion: __APP_VERSION__,
        song: toEventSong(song),
        ...(extra ?? {}),
      }),
    });
    // First contact: the server answers 200 + { signed_device_id_next } once;
    // store it so every later post keeps the same stable identity.
    if (res.status === 200) {
      const j = (await res.json().catch(() => null)) as { signed_device_id_next?: string } | null;
      if (j?.signed_device_id_next) setLocal(KEYS.signedDeviceId, j.signed_device_id_next);
    }
  } catch {
    /* analytics is best-effort and must never affect playback */
  }
}

let errorCount = 0;
const seenErrors = new Set<string>();

/** Report an app error to Technical Monitoring (throttled + deduped). */
/** A song had no lyrics from any source — feeds lyric-coverage in Technical Monitoring. */
export function reportLyricMiss(song: Song): void {
  void send('lyric-miss', song);
}

export function reportError(kind: string, message: unknown): void {
  const msg = String(message ?? '').slice(0, 300);
  const key = kind + '|' + msg;
  if (errorCount >= 25 || seenErrors.has(key)) return;
  seenErrors.add(key);
  errorCount += 1;
  void send('error', null, { errorKind: kind, message: msg });
}

function currentSong(): Song | null {
  const s = usePlayerStore.getState();
  return s.queue[s.index] ?? null;
}

/** Called from onboarding right after the listener enters name + consent. */
export function registerUser(): void {
  void send('register', currentSong());
}

let started = false;
let telemetryUnsubscribe: (() => void) | null = null;
let telemetryInterval: number | null = null;

/**
 * Idempotent teardown for tests / Fast Refresh (audit finding M6). Without
 * this, a hot-reload cycle that clears the module-level `started` guard
 * would leak the store subscription and the 25 s heartbeat interval on
 * every remount.
 */
export function disposeTelemetry(): void {
  telemetryUnsubscribe?.();
  telemetryUnsubscribe = null;
  if (telemetryInterval != null) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
  started = false;
}

export function initTelemetry(): void {
  if (started) return;
  started = true;

  let lastSongId: string | null = null;
  let lastPlaying = false;

  // Presence ping so a brand-new listener appears in Live immediately.
  void send('open');

  // Field Web Vitals (LCP / INP / CLS) → Technical Monitoring. Loaded post-idle
  // as its own chunk so measuring never affects the metric being measured, and
  // gated by the same consent as every other event.
  const startVitals = (): void => {
    void import('web-vitals')
      .then(({ onLCP, onINP, onCLS }) => {
        const report = (m: { name: string; value: number; rating: string }): void => {
          const value = m.name === 'CLS' ? m.value.toFixed(3) : `${Math.round(m.value)}ms`;
          void send('vital', null, {
            errorKind: m.name,
            message: `${value} ${m.rating} ${window.location.pathname}`,
          });
        };
        onLCP(report);
        onINP(report);
        onCLS(report);
      })
      .catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => startVitals(), { timeout: 4000 });
  } else {
    window.setTimeout(startVitals, 3000);
  }

  telemetryUnsubscribe = usePlayerStore.subscribe((s) => {
    const song = s.queue[s.index] ?? null;
    const id = song?.id ?? null;
    if (id && s.isPlaying && id !== lastSongId) {
      lastSongId = id;
      void send('play', song);
    }
    if (!s.isPlaying && lastPlaying) void send('pause', song);
    lastPlaying = s.isPlaying;
  });

  telemetryInterval = window.setInterval(() => {
    const s = usePlayerStore.getState();
    const song = s.queue[s.index] ?? null;
    if (s.isPlaying && song) void send('heartbeat', song);
  }, HEARTBEAT_MS);

  // Surface uncaught errors to Technical Monitoring.
  window.addEventListener('error', (e: ErrorEvent) => reportError('js', e.message || 'error'));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | undefined;
    reportError('promise', (r && r.message) || String(e.reason ?? 'rejection'));
  });
}

/** Search analytics: query + result count ("0|query" marks a content gap). */
export function trackSearch(query: string, results: number): void {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return;
  void send('search', null, { message: `${Math.max(0, Math.floor(results))}|${q}` });
}
export function trackSkip(song: Song): void {
  void send('skip', song);
}
export function trackComplete(song: Song): void {
  void send('complete', song);
}
export function trackFavorite(song: Song): void {
  void send('favorite', song);
}
export function trackShare(): void {
  void send('share', currentSong());
}
export function trackDownload(song: Song): void {
  void send('download', song);
}
