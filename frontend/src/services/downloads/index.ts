import { Capacitor } from '@capacitor/core';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useDownloadsStore } from '@/store/downloadsStore';
import { reportError } from '@/services/analytics/telemetry';

/**
 * Offline downloads (Android app only). Audio is fetched with native HTTP (no
 * CORS), saved to the app's data directory, and played from the local file.
 * Strictly additive: getOfflineUrl is prepended to the engine's source list, so
 * if a local file is ever missing/corrupt the engine falls back to streaming.
 */
const urlMap = new Map<string, string>();

export function getOfflineUrl(id: string): string | null {
  return urlMap.get(id) ?? null;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** Use the source format for the saved file so the WebView decodes it reliably. */
function extOf(url: string): string {
  const m = url.match(/\.(mp4|m4a|mp3|aac|ogg|webm)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase() : 'mp4';
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

/** Rebuild the local-URL map from persisted downloads (native only). */
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
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    urlMap.set(song.id, Capacitor.convertFileSrc(uri));
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
  if (isNativePlatform() && item?.path) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({ path: item.path, directory: Directory.Data });
    } catch {
      /* already gone */
    }
  }
}
