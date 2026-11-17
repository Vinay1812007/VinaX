import { create } from 'zustand';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useSettingsStore } from '@/store/settingsStore';
import { castMediaFor, type CastMedia } from './media';

export { castMime } from './media';
export type { CastMedia } from './media';

/**
 * Casting, the part the first load needs: the store, the player's intercepts
 * and the song handoff. The senders load on demand: the Cast web SDK glue
 * (./web.ts, when the device sheet opens) and the Android app's VinaxCast
 * plugin (./native.ts); what they share about a session is ./session.ts.
 */
export interface CastState {
  available: boolean;
  connected: boolean;
  deviceName: string | null;
  /** Casting through the Android app's own plugin (no web SDK button). */
  native: boolean;
  /** Android app: a TV or speaker was found nearby (the web SDK's button hides itself). */
  nearby: boolean;
}

/**
 * One way of talking to a receiver: the Cast web SDK or the Android app's
 * plugin. While casting, the receiver plays and the phone's own <audio>
 * element plays muted as the clock that moves the queue on when a song ends.
 */
export interface CastTransport {
  load(media: CastMedia, opts: { autoplay: boolean; startTime: number }): Promise<unknown>;
  setPlaying(play: boolean): void;
  seek(seconds: number): void;
  setVolume(level: number): void;
  requestSession(): void;
}

let transport: CastTransport | null = null;

/** Shared with ./session.ts: what the receiver was told, to tell its fresh reports from stale ones. */
export const castSync = {
  /** The stream the receiver was last sent: its reports about anything else are stale. */
  sentUrl: null as string | null,
  /** What the receiver last said (or was last told): only a change is acted on. */
  remotePlaying: null as boolean | null,
  /** Reports until then may predate the last load, seek or play/pause. */
  quietUntil: 0,
};
const QUIET_MS = 2500;
const hush = (): void => {
  castSync.quietUntil = Date.now() + QUIET_MS;
};

export const useCastStore = create<CastState>(() => ({
  available: false,
  connected: false,
  deviceName: null,
  native: false,
  nearby: false,
}));

export function setCastTransport(t: CastTransport | null): void {
  transport = t;
}

export const castDevError = (what: string, e: unknown): void => {
  if (import.meta.env.DEV) console.error(what, e);
};

/** Send a song to the receiver; null when there is no receiver or no stream it can fetch. */
export function castSend(song: Song, autoplay: boolean, startTime: number): Promise<unknown> | null {
  const media = transport ? castMediaFor(song, useSettingsStore.getState().audioQuality) : null;
  if (!transport || !media) return null;
  castSync.sentUrl = media.url;
  castSync.remotePlaying = null;
  hush();
  try {
    return transport.load(media, { autoplay, startTime: Math.max(0, startTime || 0) });
  } catch (e) {
    return Promise.reject(e);
  }
}

/** The player started a song while casting: the receiver plays it too. */
export function castLoadSong(song: Song, autoplay: boolean, startTime = 0): void {
  if (!useCastStore.getState().connected) return;
  castSend(song, autoplay, startTime)?.catch((e) => castDevError('Cast load failed:', e));
}

/** Open the TV picker (or, while casting, the device's own card). False when Cast is not ready. */
export function castRequestSession(): boolean {
  if (!transport) return false;
  try {
    transport.requestSession();
    return true;
  } catch {
    return false;
  }
}

/** Load casting when the device sheet first opens, never on an ordinary
 *  visit or app start (4.18.0, PSI unused-JS pass; the privacy page says so):
 *  the web SDK, or in the Android app the VinaxCast plugin. Idempotent. */
let sdkRequested = false;
export function ensureCastSdk(): void {
  if (sdkRequested || typeof document === 'undefined') return;
  sdkRequested = true;
  if (isNativePlatform()) {
    void import('./native').then((m) => m.startNativeCast()).catch(() => undefined);
    return;
  }
  void import('./web')
    .then((m) => {
      m.bootWebCast();
      const s = document.createElement('script');
      s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      s.async = true;
      document.head.appendChild(s);
    })
    .catch(() => undefined);
}

/**
 * Local play / pause while casting goes to the receiver (`play` is what the
 * listener asked for). The caller keeps the silent local clock in step.
 */
export function castInterceptPlayPause(play: boolean): boolean {
  if (!useCastStore.getState().connected || !transport) return false;
  transport.setPlaying(play);
  castSync.remotePlaying = play;
  hush();
  return true; // Intercepted
}

export function castInterceptSeek(seconds: number): boolean {
  if (!useCastStore.getState().connected || !transport) return false;
  transport.seek(seconds);
  hush();
  return true; // Intercepted
}

/** Volume goes to the receiver while casting — the local element stays silent. */
export function castInterceptVolume(v: number): boolean {
  if (!useCastStore.getState().connected || !transport) return false;
  transport.setVolume(Math.min(1, Math.max(0, v)));
  return true; // Intercepted
}
