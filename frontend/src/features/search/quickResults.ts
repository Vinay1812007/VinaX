/**
 * v5.19.0 — search-as-you-type previews ("Quick results"): a lightweight
 * `searchSongs(q, 6)` per settled keystroke, memoised in a small module cache
 * so backspacing through a query never refetches. Keys are the page's
 * normalised query (trimmed, case- and whitespace-folded), which is what
 * keeps "arijit" and "arijit " on one entry and one request.
 */
import type { Song } from '@/types';
import { searchSongs } from '@/services/api/saavn';

export const QUICK_LIMIT = 6;
export const QUICK_CACHE_MAX = 50;
export const QUICK_TTL_MS = 5 * 60_000;

const cache = new Map<string, { at: number; songs: Song[] }>();

/** Cached preview for `key`, or null when absent/expired. */
export function getCachedQuick(key: string, now = Date.now()): Song[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > QUICK_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Touch: re-insert so the eviction below is least-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.songs;
}

/** Remember a preview (also used to seed from a full search's first songs). */
export function putCachedQuick(key: string, songs: Song[], now = Date.now()): void {
  if (!key) return;
  cache.delete(key);
  cache.set(key, { at: now, songs: songs.slice(0, QUICK_LIMIT) });
  while (cache.size > QUICK_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test hook. */
export function clearQuickCache(): void {
  cache.clear();
}

export function quickCacheSize(): number {
  return cache.size;
}

/**
 * Fetch (or serve from cache) the top songs for `key`. An aborted request
 * rejects and is never cached, so a cancelled keystroke leaves no trace.
 */
export async function fetchQuickResults(
  key: string,
  signal?: AbortSignal,
  search: (q: string, limit: number, opts?: { signal?: AbortSignal }) => Promise<Song[]> = searchSongs,
): Promise<Song[]> {
  const cached = getCachedQuick(key);
  if (cached) return cached;
  const songs = (await search(key, QUICK_LIMIT, { signal })).slice(0, QUICK_LIMIT);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  putCachedQuick(key, songs);
  return songs;
}
