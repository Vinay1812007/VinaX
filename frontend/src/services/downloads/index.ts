import { Capacitor } from '@capacitor/core';
import type { FilesystemPlugin } from '@capacitor/filesystem';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useDownloadsStore, type DownloadDir } from '@/store/downloadsStore';
import { reportError } from '@/services/analytics/telemetry';

/**
 * Offline downloads (Android app only). Audio is fetched with native HTTP (no
 * CORS) and saved into the app's own folder on device storage, so saved songs
 * play from local files exactly like any offline-first player.
 *
 * v5.7.3 — offline sources are now available the INSTANT the app opens. The
 * boot rebuild used to fill the playable-URL map asynchronously (base64 file
 * reads, cache writes — seconds of work), so an offline launch that tapped a
 * downloaded song in its first moments found an EMPTY map, fell through to
 * streaming URLs, and died with "music servers unreachable" — the exact
 * failure reported from the field. Two changes kill that race for good:
 *   1. getOfflineSources() derives the service-worker route (a pure function
 *      of the id) and the file-bridge URL (from the uri persisted at save
 *      time) synchronously — no boot work needed for a saved song to play.
 *   2. New downloads store into the app's folder on device storage
 *      (Android/data/<app>/files), with the internal data directory as the
 *      fallback; every file operation honors the directory each item was
 *      saved under, so old downloads keep playing untouched.
 *
 * v5.6.0 — downloads play best from blob: URLs materialized out of the Cache
 * API: the bytes never touch the network stack, the service worker or the
 * WebView's request-interception layer at play time. The /offline-audio/ SW
 * route and the file-bridge URL remain as ordered fallbacks, and every saved
 * song exposes ALL of its offline sources to the audio engine.
 */
const urlMap = new Map<string, string>();

/** File-bridge (convertFileSrc) URLs — the last-resort offline source. */
const bridgeMap = new Map<string, string>();

/** Same-origin cache bucket the service worker serves audio from (sw.js). */
const AUDIO_CACHE = 'vinax-audio-v1';

type FsDirectory = import('@capacitor/filesystem').Directory;
type FsDirectoryEnum = typeof import('@capacitor/filesystem').Directory;

/** Resolve a persisted directory tag to the runtime enum (legacy → Data). */
function dirOf(D: FsDirectoryEnum, tag?: DownloadDir): FsDirectory {
  return tag === 'EXTERNAL' ? D.External : D.Data;
}

export function getOfflineUrl(id: string): string | null {
  return urlMap.get(id) ?? null;
}

/**
 * Every offline source for a song, best first: the blob: URL (no network
 * stack at all), the /offline-audio/ service-worker route, then the file
 * bridge. The audio engine tries them in order before any streaming URL.
 *
 * v5.7.3 — for a saved song the SW route and the bridge are derived HERE,
 * synchronously, instead of waiting on the async boot rebuild: a download
 * always has playable offline sources from the app's very first frame.
 */
export function getOfflineSources(id: string): string[] {
  const out: string[] = [];
  const main = urlMap.get(id);
  if (main) out.push(main);
  const item = isNativePlatform() ? useDownloadsStore.getState().items[id] : undefined;
  if (item) {
    const sw = audioUrlFor(id);
    if (!out.includes(sw)) out.push(sw);
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

function bestAudioUrl(song: Song): string | null {
  // Parse the NUMBER out of the quality label instead of exact-matching
  // '320kbps' strings — upstreams label variants '320', '320 kbps', etc.,
  // and an exact-match miss used to sort them last and download whatever
  // happened to be first (often the lowest quality).
  const kbps = (q: string | undefined): number => {
    const m = /(\d+)/.exec(q ?? '');
    return m ? Number(m[1]) : 0;
  };
  const sorted = [...song.audio].filter((v) => v.url).sort((a, b) => kbps(b.quality) - kbps(a.quality));
  return sorted[0]?.url ?? song.audio[0]?.url ?? null;
}

/** A saved file smaller than this cannot be a real song — it's an upstream
 *  error body (CDN "Access Denied" XML, an HTML error page) that arrived
 *  with a 200. Even a 10-second 48 kbps jingle is ~60 KB. */
const MIN_VALID_BYTES = 10 * 1024;

/** Decode base64 into a Blob in bounded slices (each a multiple of 4 chars). */
function base64ToBlob(b64: string, mime: string): Blob {
  const CHUNK = 0x8000 * 4;
  const parts: BlobPart[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    const bin = atob(b64.slice(i, i + CHUNK));
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j += 1) arr[j] = bin.charCodeAt(j);
    parts.push(arr);
  }
  return new Blob(parts, { type: mime });
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
 * in place. One song at a time, so the transient base64 read stays bounded.
 */
async function cacheAudioFromDisk(
  id: string,
  path: string,
  fs: FilesystemPlugin,
  directory: FsDirectory,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const { data } = await fs.readFile({ path, directory });
    let blob: Blob;
    if (typeof data === 'string') {
      // Chunked base64 decode — a giant data: URL fetch proved fragile on
      // real devices for 320kbps files; atob over bounded slices is boring
      // and works at any size.
      blob = base64ToBlob(data, mimeForPath(path));
    } else if (data instanceof Blob) {
      blob = data;
    } else {
      return false;
    }
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
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
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
    // Phase 3 — heavy: cache entries + blob upgrades, one song at a time.
    for (const id of ids) {
      const it = items[id];
      if (!it.path) continue;
      const directory = dirOf(Directory, it.dir);
      try {
        if ((await hasCachedAudio(id)) || (await cacheAudioFromDisk(id, it.path, Filesystem, directory))) {
          urlMap.set(id, (await blobUrlFromCache(id)) ?? audioUrlFor(id));
          continue;
        }
        const bridge = bridgeMap.get(id);
        if (bridge) urlMap.set(id, bridge);
      } catch {
        /* leave unmapped — getOfflineSources still derives SW + bridge */
      }
    }
  } catch {
    /* filesystem unavailable */
  }
}

export async function downloadSong(song: Song): Promise<boolean> {
  void import('@/services/analytics/telemetry').then((m) => m.trackDownload(song)).catch(() => undefined);
  if (!isNativePlatform()) return false;
  if (useDownloadsStore.getState().items[song.id]) return true;
  const rawUrl = bestAudioUrl(song);
  if (!rawUrl) return false;
  // Some CDN variants are http:// — Android blocks cleartext, so force TLS.
  const url = rawUrl.replace(/^http:\/\//, 'https://');

  useDownloadsStore.getState().setDownloading(song.id, true);
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = `vinax-downloads/${safeId(song.id)}.${extOf(url)}`;
    const saveTo = async (directory: FsDirectory): Promise<void> => {
      try {
        // Preferred: stream straight to disk — no base64 through the JS
        // bridge, so big 320kbps files cannot blow the bridge or memory.
        await Filesystem.downloadFile({ url, path, directory, recursive: true });
      } catch {
        // Fallback for older plugin versions: bridge transfer.
        const { CapacitorHttp } = await import('@capacitor/core');
        const res = await CapacitorHttp.get({ url, responseType: 'blob' });
        if (res.status !== 200 || typeof res.data !== 'string') {
          throw new Error(`http ${res.status}`);
        }
        await Filesystem.writeFile({ path, data: res.data, directory, recursive: true });
      }
    };
    // v5.7.3 — save into the app's own folder on device storage
    // (Android/data/<app>/files/vinax-downloads) so downloads live with the
    // app like any offline-first player; devices without usable external
    // storage fall back to the internal data directory.
    let dirTag: DownloadDir = 'EXTERNAL';
    try {
      await saveTo(dirOf(Directory, 'EXTERNAL'));
    } catch {
      dirTag = 'DATA';
      await saveTo(dirOf(Directory, 'DATA'));
    }
    const directory = dirOf(Directory, dirTag);
    // Validate the bytes on disk: the downloader streams whatever the server
    // sent, so a 200-shaped error page would otherwise be saved as a "song"
    // and fail silently at play time.
    try {
      const st = await Filesystem.stat({ path, directory });
      if (typeof st.size === 'number' && st.size < MIN_VALID_BYTES) {
        await Filesystem.deleteFile({ path, directory }).catch(() => undefined);
        throw new Error(`invalid download (${st.size} bytes)`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('invalid download')) throw e;
      /* stat unsupported — keep the file, playback fallback still covers us */
    }
    // Resolve the absolute uri ONCE and persist it with the item — this is
    // what makes the file-bridge source available instantly on future boots.
    let uri: string | undefined;
    try {
      const r = await Filesystem.getUri({ path, directory });
      uri = r.uri;
      bridgeMap.set(song.id, Capacitor.convertFileSrc(r.uri));
    } catch {
      /* bridge unavailable */
    }
    if (await cacheAudioFromDisk(song.id, path, Filesystem, directory)) {
      urlMap.set(song.id, (await blobUrlFromCache(song.id)) ?? audioUrlFor(song.id));
    } else {
      const bridge = bridgeMap.get(song.id);
      if (bridge) urlMap.set(song.id, bridge);
    }
    useDownloadsStore.getState().add(song, path, uri, dirTag);
    return true;
  } catch (e) {
    // Surface the real device error in Technical Monitoring instead of dying silently.
    reportError('download', `${song.title}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    useDownloadsStore.getState().setDownloading(song.id, false);
  }
}

/** Download a list of songs sequentially (native only). Already-saved tracks are skipped. */
export async function downloadMany(
  songs: Song[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; failed: number }> {
  if (!isNativePlatform()) return { saved: 0, failed: 0 };
  let saved = 0;
  let failed = 0;
  for (let i = 0; i < songs.length; i++) {
    const ok = await downloadSong(songs[i]);
    if (ok) saved += 1;
    else failed += 1;
    onProgress?.(i + 1, songs.length);
  }
  return { saved, failed };
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
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({ path: item.path, directory: dirOf(Directory, item.dir) });
    } catch {
      /* already gone */
    }
  }
}
