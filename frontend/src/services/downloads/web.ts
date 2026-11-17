import type { Song } from '@/types';
import { useDownloadsStore } from '@/store/downloadsStore';
import { toast } from '@/store/toastStore';
import { iosWeb, standaloneWeb } from '@/utils/platform';
import { router } from '@/router';
import {
  ATTEMPT_TIMEOUT_MS,
  AUDIO_CACHE,
  DownloadError,
  MIN_VALID_BYTES,
  audioUrlFor,
  cacheState,
  classifyDownloadError,
  downloadUrls,
  fail,
  isOffline,
  lastFailure,
  mimeForPath,
  removeDownload,
  withStreams,
  type DownloadFailure,
} from './index';

/**
 * 1.16 — saving songs in the web app (desktop browsers, and an iPhone or iPad
 * with VinaX on the Home Screen). Loaded on the first save only.
 *
 * The audio is fetched with CORS (the catalogue CDN, aac.saavncdn.com, answers
 * `Access-Control-Allow-Origin: *`, checked 2026-11-17) and put into the same
 * AUDIO_CACHE bucket the Android app uses, under /offline-audio/<id>, which
 * sw.js serves with Range support. The bitrate ladder is the Android one
 * (Settings → Download quality first). A host that refuses CORS gives an
 * opaque answer the page cannot read: that is never stored, the song says
 * "Not available to save" instead. No bytes pass through the Worker.
 */

/** Hosts the page may fetch audio from: the CSP's connect-src (public/_headers)
 *  allows these (`https://*.saavncdn.com`, `https://*.vinaxmusic.online`: a
 *  subdomain, never the bare name), so any other host would be blocked before
 *  it answers. */
const SAVE_HOSTS = /\.(saavncdn\.com|vinaxmusic\.online)$/i;

/** Refuse a save that would leave less than this free for the app itself. */
export const MIN_FREE_BYTES = 50 * 1024 * 1024;
/** Above this, saved songs get a gentle "that's a lot" note. */
export const WARN_BYTES = 1024 * 1024 * 1024;

const PROBE_TIMEOUT_MS = 15_000;

export function savableUrl(url: string, origin: string = location.origin): boolean {
  try {
    const u = new URL(url, origin);
    if (u.origin === origin) return true;
    return u.protocol === 'https:' && SAVE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export interface StorageInfo {
  usage: number;
  quota: number;
}

/** How much this site stores and may store (null when the browser won't say). */
export async function storageInfo(): Promise<StorageInfo | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || typeof est.usage !== 'number' || typeof est.quota !== 'number') return null;
    return { usage: est.usage, quota: est.quota };
  } catch {
    return null;
  }
}

/**
 * A CORS refusal and a dead network both reject a fetch with the same
 * TypeError. A no-cors request tells them apart: it still reaches a server
 * that refuses CORS (an opaque answer, aborted at once and never read).
 */
async function reachable(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(url, { mode: 'no-cors', credentials: 'omit', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
    ctrl.abort(); // don't download the body
  }
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One rung of the ladder: the whole file as a Blob, or a DownloadError. */
export async function fetchAudio(url: string): Promise<Blob> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) throw new DownloadError('timeout', `no answer after ${ATTEMPT_TIMEOUT_MS} ms`);
      if (isOffline()) throw new DownloadError('offline', msgOf(e));
      throw new DownloadError((await reachable(url)) ? 'blocked' : 'offline', `cors fetch failed: ${msgOf(e)}`);
    }
    // Never store an answer the page can't read (mode 'cors' should not give one).
    if (res.type === 'opaque' || res.type === 'opaqueredirect') throw new DownloadError('blocked', `opaque answer (${res.type})`);
    if (!res.ok) throw new DownloadError(res.status >= 400 && res.status < 500 ? 'unavailable' : 'unknown', `http ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (/text|html|xml|json/i.test(type)) throw new DownloadError('unavailable', `not audio (${type})`);
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch (e) {
      if (ctrl.signal.aborted) throw new DownloadError('timeout', 'the transfer stalled');
      throw new DownloadError(isOffline() ? 'offline' : 'unknown', msgOf(e));
    }
    if (blob.size < MIN_VALID_BYTES) throw new DownloadError('unavailable', `invalid download (${blob.size} bytes)`);
    return blob;
  } finally {
    clearTimeout(t);
  }
}

async function putAudio(id: string, blob: Blob, url: string): Promise<void> {
  const type = blob.type || mimeForPath(new URL(url, location.origin).pathname);
  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(
      audioUrlFor(id),
      new Response(blob, { headers: { 'content-type': type, 'content-length': String(blob.size), 'accept-ranges': 'bytes' } }),
    );
  } catch (e) {
    throw new DownloadError('storage', `cache: ${msgOf(e)}`);
  }
}

/** Go to Downloads. A static import (like TutorialRunner's): a dynamic import('@/router') would
 *  split the app shell out of the entry chunk and cost about 6.6 KB of first-load JS. */
function openDownloads(): void {
  void router.navigate('/offline');
}

let firstSaveDone = false;
let warnedBig = false;

/** Tests only: start a fresh session's one-time notes. */
export function resetSaveNotes(): void {
  firstSaveDone = false;
  warnedBig = false;
}

/** After a save: ask the browser to keep this site's storage (once a session),
 *  suggest Add to Home Screen on an iPhone, and note a large total. */
async function afterSave(): Promise<void> {
  if (!firstSaveDone) {
    firstSaveDone = true;
    try {
      const st = navigator.storage;
      if (st?.persist && !(await st.persisted?.())) await st.persist();
    } catch {
      /* the browser decides; nothing to do */
    }
    if (iosWeb() && !standaloneWeb()) {
      // After the menu's "Saved for offline", not before it.
      setTimeout(
        () =>
          toast('Add VinaX to your Home Screen so Safari keeps your saved songs', {
            action: { label: 'How', onClick: openDownloads },
            duration: 8000,
            key: 'web-save-tip',
          }),
        400,
      );
      return;
    }
  }
  if (warnedBig) return;
  const info = await storageInfo();
  if (info && info.usage > WARN_BYTES) {
    warnedBig = true;
    setTimeout(
      () => toast('Saved songs now use over 1 GB on this device', { action: { label: 'Manage', onClick: openDownloads }, key: 'web-save-tip' }),
      400,
    );
  }
}

/** Save one song for offline in the browser. Never throws. */
export async function saveWebSong(original: Song): Promise<boolean> {
  if (isOffline()) return fail(original, 'offline', 'device offline');
  const song = await withStreams(original);
  const all = downloadUrls(song);
  if (!all.length) return fail(song, 'unavailable', 'no audio variants');
  const urls = all.filter((u) => savableUrl(u));
  if (!urls.length) return fail(song, 'blocked', `audio host not allowed: ${hostOf(all[0])}`);
  if (typeof caches === 'undefined') return fail(song, 'storage', 'no Cache API');
  const info = await storageInfo();
  if (info && info.quota - info.usage < MIN_FREE_BYTES) return fail(song, 'storage', `only ${info.quota - info.usage} bytes left`);

  const store = useDownloadsStore.getState();
  store.setDownloading(song.id, true);
  try {
    let reason: DownloadFailure = 'unknown';
    let detail = '';
    // Same ladder as Android: a missing variant moves on to the next; a dead
    // network, a stall, a full disk or a refusing host stops.
    for (const url of urls) {
      try {
        const blob = await fetchAudio(url);
        await putAudio(song.id, blob, url);
        lastFailure.delete(song.id);
        cacheState.set(song.id, true);
        useDownloadsStore.getState().add(song, undefined, undefined, undefined, blob.size);
        void afterSave();
        return true;
      } catch (e) {
        reason = classifyDownloadError(e);
        detail = msgOf(e);
        if (reason !== 'unavailable' && reason !== 'unknown') break;
      }
    }
    if (isOffline()) reason = 'offline';
    return fail(song, reason, detail);
  } finally {
    useDownloadsStore.getState().setDownloading(song.id, false);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url, location.origin).host;
  } catch {
    return 'bad url';
  }
}

/**
 * Boot check: a saved song whose cache entry is gone (the browser cleared the
 * site's storage) is no longer listed as saved, so it can be saved again
 * instead of failing offline. Does nothing when the cache can't be read.
 */
export async function checkWebSaves(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let cache: Cache;
  try {
    cache = await caches.open(AUDIO_CACHE);
  } catch {
    return 0;
  }
  let dropped = 0;
  for (const id of Object.keys(useDownloadsStore.getState().items)) {
    let hit: Response | undefined;
    try {
      hit = await cache.match(audioUrlFor(id));
    } catch {
      return dropped; // unreadable — don't guess
    }
    if (hit) cacheState.set(id, true);
    else {
      dropped += 1;
      await removeDownload(id);
    }
  }
  return dropped;
}
