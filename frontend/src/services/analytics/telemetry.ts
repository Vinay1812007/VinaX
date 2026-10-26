import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { installId } from '@/services/identity/installId';
import { isNativePlatform, platformName } from '@/services/native';
import { onPlaybackEvent } from '@/services/playback/session';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';

/**
 * Privacy-bounded usage telemetry. 14.0.3 — on by default, off with one
 * switch (the welcome's pre-ticked box, or Settings → Region & privacy): the
 * owner console's Live, Listeners and Analytics pages read only these events,
 * and with an unticked box almost nobody appeared in them. We send only an
 * anonymous device id, an optional display name, and the current song; coarse
 * geo is added at the edge (never the raw IP). Third-party session insights
 * (sessionInsights.ts) are NOT covered by this: they keep their own opt-in.
 * On web the endpoint is same-origin; the native app posts to the deployed
 * function.
 *
 * 7.2.0 — a `play` is sent when the playback session COUNTS the play (enough
 * of it heard, once per run: services/playback/session.ts), not when a new
 * song id starts: flipping past a song no longer inflates the owner's play
 * counts, and usage analytics count plays by the same rule as the taste
 * profile. Structured events (recommendation telemetry) carry a small `meta`
 * record; the Worker whitelists and clips it.
 */
const ENDPOINT = isNativePlatform()
  ? 'https://www.vinaxmusic.online/api/events'
  : '/api/events';
const PLATFORM = platformName();
const HEARTBEAT_MS = 25_000;
/**
 * 13.7.3 — the version a row reports: on Android the installed APK's version
 * and build (the app loads the live website, so __APP_VERSION__ is the
 * website's build there). Read once at start-up from services/native/version.
 */
let appVersion: string = __APP_VERSION__;


/** Usage sharing: on unless the listener switched it off. */
export function consented(): boolean {
  return getLocal<boolean>(KEYS.analyticsConsent, true) !== false;
}

/**
 * 14.0.3 — the one-time move to on-by-default. Devices that onboarded before
 * this hold `false` from a box they never ticked (unticked by default until
 * now), so that value cannot mean a choice; it is cleared once, and the
 * listener is told, with the switch one tap away. Returns true when it did.
 */
export function applyUsageSharingDefault(): boolean {
  if (getLocal<boolean>(KEYS.usageSharingDefaultOn, false) === true) return false;
  setLocal(KEYS.usageSharingDefaultOn, true);
  if (getLocal<boolean>(KEYS.analyticsConsent, true) !== false) return false;
  setLocal(KEYS.analyticsConsent, true);
  return true;
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

/** A flat record of numbers, short strings, booleans, nulls, string lists and string maps. */
export type TelemetryMeta = Record<string, string | number | boolean | null | string[] | Record<string, string>>;

/** Largest serialised `meta` the client will send; anything bigger is dropped, never truncated mid-value. */
export const META_MAX_BYTES = 1024;

async function send(type: string, song?: Song | null, extra?: Record<string, unknown>, meta?: TelemetryMeta): Promise<void> {
  if (!consented()) return;
  if (meta && JSON.stringify(meta).length > META_MAX_BYTES) return;
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
        deviceId: installId(),
        // H-SRV-6 loop closure: echo the HMAC-signed id the server issued on
        // first contact. Without it the server derives an ip+ua id on EVERY
        // post, so one listener appeared as a fresh "user" after every
        // network/IP change (the admin duplicate-rows bug).
        signed_device_id: getLocal<string>(KEYS.signedDeviceId, '') || undefined,
        name: getLocal<string>(KEYS.userName, '') || undefined,
        type,
        platform: PLATFORM,
        appVersion,
        song: toEventSong(song),
        ...(extra ?? {}),
        ...(meta ? { meta } : {}),
      }),
    });
    // First contact: the server answers 200 + { signed_device_id_next } once;
    // store it so every later post keeps the same stable identity.
    if (res.status === 200) {
      const j = (await res.json().catch(() => null)) as { signed_device_id_next?: string } | null;
      if (j?.signed_device_id_next) {
        setLocal(KEYS.signedDeviceId, j.signed_device_id_next);
        // A signed-in listener's device just got its id: link it to the account now (one console row).
        if (getLocal<unknown>(KEYS.account, null)) void import('@/services/auth/google').then((m) => m.relinkDevice()).catch(() => undefined);
      }
    }
  } catch {
    /* analytics is best-effort and must never affect playback */
  }
}

/**
 * A structured event with no song attached: only the fields every event
 * already carries (device ids, optional name, platform, app version) plus
 * `meta`. Consent-gated like everything else here.
 */
export function trackStructured(type: string, meta: TelemetryMeta): Promise<void> {
  return send(type, null, undefined, meta);
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
let playbackUnsubscribe: (() => void) | null = null;
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
  playbackUnsubscribe?.();
  playbackUnsubscribe = null;
  if (telemetryInterval != null) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
  started = false;
}

export function initTelemetry(): void {
  if (started) return;
  started = true;

  let lastPlaying = false;

  // Presence ping so a brand-new listener appears in Live immediately. On
  // Android it waits for the installed version (a few ms) so the row is right.
  if (isNativePlatform()) {
    void import('@/services/native/version')
      .then((m) => m.resolveAppVersion())
      .then((v) => {
        appVersion = v;
      })
      .catch(() => undefined)
      .then(() => send('open'));
  }
  else void send('open');

  // 13.7.3 — back in the foreground: check in at once. A backgrounded Android
  // WebView throttles timers, so the 25 s heartbeat can lapse while the phone
  // is locked; without this the listener stayed missing from Live (and their
  // session from the console) until the next play.
  let lastPresence = 0;
  const presence = (): void => {
    if (document.visibilityState !== 'visible' || Date.now() - lastPresence < 15_000) return;
    lastPresence = Date.now();
    const s = usePlayerStore.getState();
    const song = s.queue[s.index] ?? null;
    void send(s.isPlaying && song ? 'heartbeat' : 'open', s.isPlaying ? song : null);
  };
  document.addEventListener('visibilitychange', presence);
  if (isNativePlatform()) {
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', presence))
      .catch(() => undefined);
  }

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

  // A play is a play when the playback session counts it (heard time, once
  // per run) — the same moment the taste profile learns its PLAY. A song
  // flipped past, or looped by repeat-one inside one run, sends nothing new.
  playbackUnsubscribe = onPlaybackEvent((e) => {
    if (e.kind === 'counted') void send('play', e.song);
  });

  // Pause and heartbeat keep live presence as before.
  telemetryUnsubscribe = usePlayerStore.subscribe((s) => {
    const song = s.queue[s.index] ?? null;
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
/** 8.5.0 — "Not interested" on a song. Like every event, only sent with analytics consent. */
export function trackDislike(song: Song): void {
  void send('dislike', song);
}
/** 8.5.0 — the listener added a song to one of their playlists. Consent-gated. */
export function trackPlaylistAdd(song: Song): void {
  void send('playlist_add', song);
}
export function trackShare(): void {
  void send('share', currentSong());
}
export function trackDownload(song: Song): void {
  void send('download', song);
}
