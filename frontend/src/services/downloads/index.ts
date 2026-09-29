import { Capacitor } from '@capacitor/core';
import type { FilesystemPlugin } from '@capacitor/filesystem';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useDownloadsStore, type DownloadDir } from '@/store/downloadsStore';
import { reportError } from '@/services/analytics/telemetry';

/**
 * Offline downloads (Android app only). Audio is fetched with native HTTP (no
 * CORS) and saved into the app's own folder, so saved songs play from local
 * files exactly like any offline-first player.
 *
 * 8.2.0 — downloads that failed on Android, fixed at the root:
 *   1. The native downloader never creates the `vinax-downloads/` folder
 *      (its `recursive` flag is ignored), so every download used to fail
 *      there and fall back to shipping the whole file through the JS bridge
 *      as base64. The folder is now created first.
 *   2. A download walks the bitrate ladder (320 → 160 → 96 → 48) instead of
 *      failing when the top bitrate does not exist for a song.
 *   3. Connect/read timeouts plus a hard cap per attempt: a stalled transfer
 *      can no longer hang "download all" forever.
 *   4. Success no longer waits on the Cache API copy — that runs in the
 *      background, reading the file back in slices instead of one giant
 *      base64 string.
 *   5. New downloads go to the internal data directory (no storage
 *      permission on any Android version); items saved to device storage
 *      by earlier versions keep their directory tag and keep playing.
 *   6. Failures carry a reason, so the listener hears "No internet
 *      connection" or "This song isn't available to download" instead of a
 *      bare "Download failed".
 *
 * v5.7.3 — getOfflineSources() derives the service-worker route (a pure
 * function of the id) and the file-bridge URL (from the uri persisted at save
 * time) synchronously, so a download is playable from the app's first frame.
 *
 * v5.6.0 — downloads play best from blob: URLs materialized out of the Cache
 * API: the bytes never touch the network stack, the service worker or the
 * WebView's request-interception layer at play time. The /offline-audio/ SW
 * route and the file-bridge URL remain as ordered fallbacks.
 */
const urlMap = new Map<string, string>();

/** File-bridge (convertFileSrc) URLs — the last-resort offline source. */
const bridgeMap = new Map<string, string>();

/** Same-origin cache bucket the service worker serves audio from (sw.js).
 *  Nothing may ever delete this bucket wholesale — not the SW's activate
 *  prune, not the boot recovery in index.html. */
const AUDIO_CACHE = 'vinax-audio-v1';

/** Folder (inside the app's directory) that holds the saved files. */
const FOLDER = 'vinax-downloads';

/** Native HTTP timeouts. The read timeout is per read — a live but slow
 *  transfer keeps going; a dead socket fails in 30 s. */
const CONNECT_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 30_000;
/** Hard cap on one attempt, in case the native side never answers at all. */
const ATTEMPT_TIMEOUT_MS = 5 * 60_000;

/** Why a download failed — picks the message the listener sees. */
export type DownloadFailure = 'offline' | 'unavailable' | 'storage' | 'timeout' | 'unknown';

const FAILURE_MESSAGES: Record<DownloadFailure, string> = {
  offline: 'No internet connection — connect and try again',
  unavailable: 'This song isn’t available to download',
  storage: 'Couldn’t save to your phone — free up some space and try again',
  timeout: 'The download stalled — check your connection and try again',
  unknown: 'Download failed — please try again',
};

/** The words to show for a failed download. */
export function downloadFailureMessage(reason: DownloadFailure | null | undefined): string {
  return FAILURE_MESSAGES[reason ?? 'unknown'];
}

/** Why the most recent download of this song failed (null after a success). */
const lastFailure = new Map<string, DownloadFailure>();
export function lastDownloadFailure(id: string): DownloadFailure | null {
  return lastFailure.get(id) ?? null;
}

class DownloadError extends Error {
  constructor(
    readonly reason: DownloadFailure,
    message: string,
  ) {
    super(message);
  }
}

const noSpace = (msg: string): boolean => /ENOSPC|No space left|disk full/i.test(msg);

/**
 * Map a native/HTTP error to a reason. The Android downloader reports an
 * HTTP 404 as a FileNotFoundException whose message is just the URL, other
 * HTTP errors as "Server returned HTTP response code: N".
 */
export function classifyDownloadError(e: unknown): DownloadFailure {
  if (e instanceof DownloadError) return e.reason;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (noSpace(msg)) return 'storage';
  if (/timed? ?out|timeout/i.test(msg)) return 'timeout';
  if (
    /Unable to resolve host|UnknownHost|Network is unreachable|ENETUNREACH|ECONNREFUSED|ECONNRESET|Connection reset|connection abort|failed to connect|No address associated|INTERNET_DISCONNECTED|Failed to fetch/i.test(
      msg,
    )
  ) {
    return 'offline';
  }
  if (/response code: 4\d\d|\bhttp 4\d\d\b/i.test(msg) || /^(Error downloading file: )?https?:\/\/\S+$/i.test(msg)) {
    return 'unavailable';
  }
  if (/EACCES|EROFS|ENOENT|open failed|No such file|Permission/i.test(msg)) return 'storage';
  return 'unknown';
}

/** Definitely offline (navigator.onLine can only be trusted when false). */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new DownloadError('timeout', `no answer after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

type Fs = typeof import('@capacitor/filesystem');
type FsDirectory = import('@capacitor/filesystem').Directory;
type FsDirectoryEnum = typeof import('@capacitor/filesystem').Directory;

/** The filesystem plugin, loaded once on first use (native only). */
let fsModule: Promise<Fs> | null = null;
const loadFs = (): Promise<Fs> => (fsModule ??= import('@capacitor/filesystem'));

/** Resolve a persisted directory tag to the runtime enum (legacy → Data). */
function dirOf(D: FsDirectoryEnum, tag?: DownloadDir): FsDirectory {
  return tag === 'EXTERNAL' ? D.External : D.Data;
}

export function getOfflineUrl(id: string): string | null {
  return urlMap.get(id) ?? null;
}

/** Per-song result of the Cache API copy this session: true = the
 *  /offline-audio/ entry exists, false = it could not be built. */
const cacheState = new Map<string, boolean>();

/**
 * Every offline source for a song, best first: the blob: URL (no network
 * stack at all), the /offline-audio/ service-worker route, then the file
 * bridge. The audio engine tries them in order before any streaming URL.
 *
 * 8.2.0 — a saved song whose cache entry is missing gets it rebuilt from the
 * file on disk in the background (the next play uses it), and the SW route
 * is left out once it is known to be missing, so the engine does not spend
 * a failed load on it.
 */
export function getOfflineSources(id: string): string[] {
  const out: string[] = [];
  const main = urlMap.get(id);
  if (main) out.push(main);
  const item = isNativePlatform() ? useDownloadsStore.getState().items[id] : undefined;
  if (item) {
    if (!cacheState.has(id)) void ensureCached(id);
    const sw = audioUrlFor(id);
    if (cacheState.get(id) !== false && !out.includes(sw)) out.push(sw);
    let bridge = bridgeMap.get(id) ?? null;
    if (!bridge && item.uri) {
      bridge = Capacitor.convertFileSrc(item.uri);
      bridgeMap.set(id, bridge);
    }
    if (bridge && !out.includes(bridge)) out.push(bridge);
    return out;
  }
  const bridge = bridgeMap.get(id);
  if (bridge && !out.includes(bridge)) out.push(bridge);
  return out;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** The synthetic same-origin URL a downloaded song plays from. */
function audioUrlFor(id: string): string {
  return `/offline-audio/${safeId(id)}`;
}

/** Use the source format for the saved file so the WebView decodes it reliably. */
function extOf(url: string): string {
  const m = url.match(/\.(mp4|m4a|mp3|aac|ogg|webm)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase() : 'mp4';
}

function mimeForPath(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? 'mp4';
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    default:
      return 'audio/mp4'; // mp4 / m4a
  }
}

/**
 * Every download URL for a song, highest bitrate first. 8.2.0 — the service
 * lists a URL for every bitrate whether or not that file exists, so taking
 * only the top one made any song without a 320 kbps master fail outright.
 * The download walks this ladder like the player does. The NUMBER is parsed
 * out of the label ('320kbps', '320', '320 kbps' all rank the same).
 */
export function downloadUrls(song: Song): string[] {
  const kbps = (q: string | undefined): number => {
    const m = /(\d+)/.exec(q ?? '');
    return m ? Number(m[1]) : 0;
  };
  const urls = [...song.audio]
    .filter((v) => v.url)
    .sort((a, b) => kbps(b.quality) - kbps(a.quality))
    // Some variants are http:// — Android blocks cleartext, so force TLS.
    .map((v) => v.url.replace(/^http:\/\//, 'https://'));
  return [...new Set(urls)];
}

/** A saved file smaller than this cannot be a real song — it's an upstream
 *  error body (CDN "Access Denied" XML, an HTML error page) that arrived
 *  with a 200. Even a 10-second 48 kbps jingle is ~60 KB. */
const MIN_VALID_BYTES = 10 * 1024;

/** Decode base64 into bytes in bounded slices (each a multiple of 4 chars). */
function base64ToParts(b64: string): Uint8Array[] {
  const CHUNK = 0x8000 * 4;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    const bin = atob(b64.slice(i, i + CHUNK));
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j += 1) arr[j] = bin.charCodeAt(j);
    parts.push(arr);
  }
  return parts;
}

/** Bytes per read when copying a file into the Cache API (a multiple of 3,
 *  so every slice is whole base64). */
const READ_SLICE = 3 * 1024 * 1024;

/**
 * Read a saved file back as a Blob, one slice at a time — no single
 * multi-megabyte base64 string crosses the bridge. An older native plugin
 * that ignores offset/length hands back the whole file on the first read;
 * that is detected (more bytes than asked for) and used as-is.
 */
async function readFileBlob(fs: FilesystemPlugin, path: string, directory: FsDirectory): Promise<Blob> {
  const parts: BlobPart[] = [];
  for (let offset = 0; ; offset += READ_SLICE) {
    const { data } = await fs.readFile({ path, directory, offset, length: READ_SLICE });
    let size: number;
    if (typeof data === 'string') {
      const bytes = base64ToParts(data);
      parts.push(...(bytes as BlobPart[]));
      size = bytes.reduce((n, b) => n + b.length, 0);
    } else if (data instanceof Blob) {
      parts.push(data);
      size = data.size;
    } else {
      throw new Error('unreadable file data');
    }
    if (size !== READ_SLICE) break; // last slice — or the whole file at once
  }
  return new Blob(parts, { type: mimeForPath(path) });
}

/**
 * The preferred playable URL: a blob: handle materialized from the cached
 * response. Plays entirely in-renderer — no network stack, no service worker,
 * no WebView interception — which is what finally makes offline bulletproof.
 */
async function blobUrlFromCache(id: string): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(AUDIO_CACHE);
    const hit = await cache.match(audioUrlFor(id));
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

/**
 * Copy a downloaded file from disk into the Cache API so the service worker
 * can serve it at /offline-audio/<id>. Returns true when the cache entry is
 * in place.
 */
async function cacheAudioFromDisk(
  id: string,
  path: string,
  fs: FilesystemPlugin,
  directory: FsDirectory,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const blob = await readFileBlob(fs, path, directory);
    if (blob.size < MIN_VALID_BYTES) return false;
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(
      audioUrlFor(id),
      new Response(blob, {
        headers: {
          'content-type': mimeForPath(path),
          'content-length': String(blob.size),
          'accept-ranges': 'bytes',
        },
      }),
    );
    return true;
  } catch (e) {
    // Visible in Technical Monitoring — a silent false here is exactly how
    // offline playback failures hid for three releases.
    reportError('offline-cache', `${id}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** True when the song's /offline-audio/ cache entry exists. */
async function hasCachedAudio(id: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(AUDIO_CACHE);
    return !!(await cache.match(audioUrlFor(id)));
  } catch {
    return false;
  }
}

/** Cache copies run one at a time, so the transient file read stays bounded. */
let cacheQueue: Promise<unknown> = Promise.resolve();
const cacheJobs = new Map<string, Promise<boolean>>();

/**
 * Make sure a saved song has its /offline-audio/ cache entry (rebuilding it
 * from the file on disk if it is missing) and upgrade its playable URL to a
 * blob: handle. Queued and de-duplicated; never throws.
 */
function ensureCached(id: string): Promise<boolean> {
  const running = cacheJobs.get(id);
  if (running) return running;
  const job = cacheQueue
    // Capped, so one file read that never answers can't wedge the queue.
    .then(() => withTimeout(cacheOne(id), 2 * 60_000))
    .catch(() => false)
    .finally(() => cacheJobs.delete(id));
  cacheQueue = job;
  cacheJobs.set(id, job);
  return job;
}

async function cacheOne(id: string): Promise<boolean> {
  const it = useDownloadsStore.getState().items[id];
  if (!it?.path) return false;
  let ok = await hasCachedAudio(id);
  if (!ok) {
    const { Filesystem, Directory } = await loadFs();
    ok = await cacheAudioFromDisk(id, it.path, Filesystem, dirOf(Directory, it.dir));
  }
  if (!useDownloadsStore.getState().items[id]) {
    // Removed while we were copying — don't leave an orphan entry behind.
    if (ok && typeof caches !== 'undefined') await caches.open(AUDIO_CACHE).then((c) => c.delete(audioUrlFor(id))).catch(() => undefined);
    return false;
  }
  cacheState.set(id, ok);
  if (ok) {
    if (!urlMap.get(id)?.startsWith('blob:')) urlMap.set(id, (await blobUrlFromCache(id)) ?? audioUrlFor(id));
  } else if (!urlMap.has(id)) {
    const bridge = bridgeMap.get(id);
    if (bridge) urlMap.set(id, bridge);
  }
  return ok;
}

/**
 * Rebuild the playable-URL map from persisted downloads (native only).
 * Phased so a saved song is playable before ANY heavy work happens:
 *   1. instant — file-bridge URLs from the uri persisted at save time;
 *   2. light — resolve + persist URIs for legacy items (no file reads);
 *   3. heavy — ensure Cache API entries and upgrade to blob: URLs.
 */
export async function initDownloads(): Promise<void> {
  if (!isNativePlatform()) return;
  const items = useDownloadsStore.getState().items;
  const ids = Object.keys(items);
  if (!ids.length) return;
  // Phase 1 — synchronous: every item that saved its uri gets a playable
  // bridge URL with zero filesystem work.
  for (const id of ids) {
    const uri = items[id].uri;
    if (uri && !bridgeMap.has(id)) bridgeMap.set(id, Capacitor.convertFileSrc(uri));
  }
  try {
    const { Filesystem, Directory } = await loadFs();
    // Phase 2 — light: legacy items (saved before uris were persisted) get
    // theirs resolved and written back, so the NEXT boot skips this pass.
    for (const id of ids) {
      const it = items[id];
      if (!it.path || it.uri) continue;
      try {
        const { uri } = await Filesystem.getUri({ path: it.path, directory: dirOf(Directory, it.dir) });
        bridgeMap.set(id, Capacitor.convertFileSrc(uri));
        useDownloadsStore.getState().setUri(id, uri);
      } catch {
        /* file gone — derived sources will fall through to streaming */
      }
    }
  } catch {
    /* filesystem unavailable */
  }
  // Phase 3 — heavy: cache entries + blob upgrades, one song at a time.
  for (const id of ids) {
    if (items[id].path) await ensureCached(id);
  }
}

/** Downloads in progress, by song id. */
const inFlight = new Map<string, Promise<boolean>>();

export async function downloadSong(song: Song): Promise<boolean> {
  void import('@/services/analytics/telemetry').then((m) => m.trackDownload(song)).catch(() => undefined);
  if (!isNativePlatform()) return false;
  if (useDownloadsStore.getState().items[song.id]) return true;
  // A double tap, or "download all" racing a single-song tap, must not write
  // the same file twice at once — later callers share the first attempt.
  const running = inFlight.get(song.id);
  if (running) return running;
  const job = runDownload(song).finally(() => inFlight.delete(song.id));
  inFlight.set(song.id, job);
  return job;
}

/**
 * One attempt: one URL into one directory. Streams straight to disk with the
 * native downloader; the bridge transfer is only the fallback for a native
 * layer that can't (an older plugin) — never for an HTTP error, a dead
 * network or a storage error, which it would just repeat.
 */
async function saveOnce({ Filesystem }: Fs, url: string, path: string, directory: FsDirectory): Promise<void> {
  // The native downloader ignores `recursive` and fails on a missing folder.
  await Filesystem.mkdir({ path: FOLDER, directory, recursive: true }).catch(() => undefined);
  const http = { connectTimeout: CONNECT_TIMEOUT_MS, readTimeout: READ_TIMEOUT_MS };
  try {
    await withTimeout(Filesystem.downloadFile({ url, path, directory, recursive: true, ...http }), ATTEMPT_TIMEOUT_MS);
  } catch (e) {
    if (classifyDownloadError(e) !== 'unknown') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const { CapacitorHttp } = await import('@capacitor/core');
    const res = await withTimeout(CapacitorHttp.get({ url, responseType: 'blob', ...http }), ATTEMPT_TIMEOUT_MS);
    if (res.status !== 200 || typeof res.data !== 'string') {
      throw new DownloadError(res.status >= 400 && res.status < 500 ? 'unavailable' : 'unknown', `${msg}; fallback http ${res.status}`);
    }
    await Filesystem.writeFile({ path, data: res.data, directory, recursive: true });
  }
  // Validate the bytes on disk: the downloader streams whatever the server
  // sent, so a 200-shaped error page would otherwise be saved as a "song"
  // and fail silently at play time.
  let size: number | undefined;
  try {
    size = (await Filesystem.stat({ path, directory })).size;
  } catch {
    /* stat unsupported — keep the file, playback fallback still covers us */
  }
  if (typeof size === 'number' && size < MIN_VALID_BYTES) {
    throw new DownloadError('unavailable', `invalid download (${size} bytes)`);
  }
}

/**
 * v8.2.0 — new downloads go to the internal data directory: it needs no
 * storage permission on any Android version (device storage did on Android
 * 10 and older), and the files are just as private. Device storage stays as
 * the fallback when the data directory can't take the file.
 */
const SAVE_DIRS: DownloadDir[] = ['DATA', 'EXTERNAL'];

async function runDownload(song: Song): Promise<boolean> {
  const urls = downloadUrls(song);
  if (!urls.length) return fail(song, 'unavailable', 'no audio variants');
  if (isOffline()) return fail(song, 'offline', 'device offline');

  useDownloadsStore.getState().setDownloading(song.id, true);
  try {
    const fs = await loadFs();
    const { Filesystem, Directory } = fs;
    let reason: DownloadFailure = 'unknown';
    let detail = '';
    // Walk the bitrate ladder: a variant that doesn't exist (or answers with
    // an error body) moves on to the next; a dead network, a stall or a full
    // disk stops — every other variant would fail the same way.
    for (const url of urls) {
      const path = `${FOLDER}/${safeId(song.id)}.${extOf(url)}`;
      for (const dirTag of SAVE_DIRS) {
        const directory = dirOf(Directory, dirTag);
        try {
          await saveOnce(fs, url, path, directory);
        } catch (e) {
          reason = classifyDownloadError(e);
          detail = e instanceof Error ? e.message : String(e);
          // Don't strand a half-written file (best-effort).
          await Filesystem.deleteFile({ path, directory }).catch(() => undefined);
          if (reason === 'storage') continue; // this directory can't take it — try the other
          break;
        }
        await finishSave(song, path, dirTag, fs);
        return true;
      }
      if (reason !== 'unavailable' && reason !== 'unknown') break;
    }
    if (isOffline()) reason = 'offline';
    return fail(song, reason, detail);
  } catch (e) {
    return fail(song, classifyDownloadError(e), e instanceof Error ? e.message : String(e));
  } finally {
    useDownloadsStore.getState().setDownloading(song.id, false);
  }
}

function fail(song: Song, reason: DownloadFailure, detail: string): false {
  lastFailure.set(song.id, reason);
  // Surface the real device error in Technical Monitoring instead of dying silently.
  reportError('download', `${song.title}: ${reason}: ${detail}`);
  return false;
}

async function finishSave(song: Song, path: string, dirTag: DownloadDir, { Filesystem, Directory }: Fs): Promise<void> {
  lastFailure.delete(song.id);
  // Resolve the absolute uri ONCE and persist it with the item — this is
  // what makes the file-bridge source available instantly on future boots.
  let uri: string | undefined;
  try {
    uri = (await Filesystem.getUri({ path, directory: dirOf(Directory, dirTag) })).uri;
    bridgeMap.set(song.id, Capacitor.convertFileSrc(uri));
  } catch {
    /* bridge unavailable */
  }
  cacheState.delete(song.id);
  useDownloadsStore.getState().add(song, path, uri, dirTag);
  // The Cache API copy is background work: the song is saved and playable
  // (SW route / file bridge) whether or not the copy has landed yet.
  void ensureCached(song.id);
}

/** Download a list of songs sequentially (native only). Already-saved tracks
 *  are skipped. `reason` is why the failures failed (the first failure's);
 *  once the device is offline the rest are counted as failed without trying. */
export async function downloadMany(
  songs: Song[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; failed: number; reason?: DownloadFailure }> {
  if (!isNativePlatform()) return { saved: 0, failed: 0 };
  let saved = 0;
  let failed = 0;
  let reason: DownloadFailure | undefined;
  for (let i = 0; i < songs.length; i++) {
    const ok = reason !== 'offline' && (await downloadSong(songs[i]));
    if (ok) saved += 1;
    else {
      failed += 1;
      reason ??= lastDownloadFailure(songs[i].id) ?? 'unknown';
    }
    onProgress?.(i + 1, songs.length);
  }
  return reason ? { saved, failed, reason } : { saved, failed };
}

export async function removeDownload(id: string): Promise<void> {
  const item = useDownloadsStore.getState().items[id];
  const main = urlMap.get(id);
  if (main?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(main);
    } catch {
      /* already gone */
    }
  }
  urlMap.delete(id);
  bridgeMap.delete(id);
  cacheState.delete(id);
  useDownloadsStore.getState().remove(id);
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(AUDIO_CACHE);
      await cache.delete(audioUrlFor(id));
    }
  } catch {
    /* cache already gone */
  }
  if (isNativePlatform() && item?.path) {
    try {
      const { Filesystem, Directory } = await loadFs();
      await Filesystem.deleteFile({ path: item.path, directory: dirOf(Directory, item.dir) });
    } catch {
      /* already gone */
    }
  }
}
