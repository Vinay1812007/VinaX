import { Capacitor } from '@capacitor/core';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useDownloadsStore } from '@/store/downloadsStore';
import { reportError } from '@/services/analytics/telemetry';

/**
 * Offline downloads (Android app only). Audio is fetched with native HTTP (no
 * CORS) and saved to the app's data directory.
 *
 * v5.5.1 — the playback path moved OFF the Android file bridge. The old flow
 * played downloads through Capacitor.convertFileSrc(...) URLs, which the
 * WebView serves via shouldInterceptRequest — but a page controlled by a
 * service worker can route media fetches around that hook entirely (a
 * documented WebView limitation), so downloaded songs LOOKED saved and never
 * played. Now every download is ALSO stored in the Cache API under a
 * same-origin /offline-audio/<id> URL that the service worker serves itself,
 * with real Range support for seeking — fully offline, no bridge, no
 * interception quirk. The file on disk stays as the durable copy: the cache
 * is rebuilt from it on boot whenever the WebView evicted it, and the
 * convertFileSrc URL remains the last-resort fallback mapping.
 */
const urlMap = new Map<string, string>();

/** Same-origin cache bucket the service worker serves audio from (sw.js). */
const AUDIO_CACHE = 'vinax-audio-v1';

export function getOfflineUrl(id: string): string | null {
  return urlMap.get(id) ?? null;
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

/**
 * Copy a downloaded file from disk into the Cache API so the service worker
 * can serve it at /offline-audio/<id>. Returns true when the cache entry is
 * in place. One song at a time, so the transient base64 read stays bounded.
 */
async function cacheAudioFromDisk(
  id: string,
  path: string,
  Filesystem: { readFile: (o: { path: string; directory: unknown }) => Promise<{ data: unknown }> },
  directory: unknown,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const { data } = await Filesystem.readFile({ path, directory });
    let blob: Blob;
    if (typeof data === 'string') {
      // Native returns base64 — a data: fetch decodes it without a JS loop.
      blob = await (await fetch(`data:${mimeForPath(path)};base64,${data}`)).blob();
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
  } catch {
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

/** Rebuild the playable-URL map from persisted downloads (native only). */
export async function initDownloads(): Promise<void> {
  if (!isNativePlatform()) return;
  const items = useDownloadsStore.getState().items;
  const ids = Object.keys(items);
  if (!ids.length) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    for (const id of ids) {
      const path = items[id].path;
      if (!path) continue;
      try {
        // Preferred: the same-origin cache URL the service worker serves —
        // rebuild the entry from disk if the WebView evicted it.
        if ((await hasCachedAudio(id)) || (await cacheAudioFromDisk(id, path, Filesystem, Directory.Data))) {
          urlMap.set(id, audioUrlFor(id));
          continue;
        }
        // Last resort: the file-bridge URL (works when no service worker
        // controls the page).
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        urlMap.set(id, Capacitor.convertFileSrc(uri));
      } catch {
        /* file gone — leave unmapped so it streams */
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
    try {
      // Preferred: stream straight to disk — no base64 through the JS bridge,
      // so big 320kbps files cannot blow the bridge or memory.
      await Filesystem.downloadFile({ url, path, directory: Directory.Data, recursive: true });
    } catch {
      // Fallback for older plugin versions: bridge transfer.
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url, responseType: 'blob' });
      // The < 1000 heuristic wrongly rejected legitimately tiny audio (jingles,
      // interstitials). res.status alone is the reliable signal — a 200 with
      // valid base64 data is a successful download regardless of length.
      if (res.status !== 200 || typeof res.data !== 'string') {
        throw new Error(`http ${res.status}`);
      }
      await Filesystem.writeFile({ path, data: res.data, directory: Directory.Data, recursive: true });
    }
    // Validate the bytes on disk: the downloader streams whatever the server
    // sent, so a 200-shaped error page would otherwise be saved as a "song"
    // and fail silently at play time.
    try {
      const st = await Filesystem.stat({ path, directory: Directory.Data });
      if (typeof st.size === 'number' && st.size < MIN_VALID_BYTES) {
        await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
        throw new Error(`invalid download (${st.size} bytes)`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('invalid download')) throw e;
      /* stat unsupported — keep the file, playback fallback still covers us */
    }
    // v5.5.1: put the audio into the same-origin cache the service worker
    // serves — the URL that actually plays offline. The file-bridge URL is
    // only the fallback mapping when the cache write fails.
    if (await cacheAudioFromDisk(song.id, path, Filesystem, Directory.Data)) {
      urlMap.set(song.id, audioUrlFor(song.id));
    } else {
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
      urlMap.set(song.id, Capacitor.convertFileSrc(uri));
    }
    useDownloadsStore.getState().add(song, path);
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
  urlMap.delete(id);
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
      await Filesystem.deleteFile({ path: item.path, directory: Directory.Data });
    } catch {
      /* already gone */
    }
  }
}
