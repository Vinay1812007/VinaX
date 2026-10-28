/**
 * Search-as-you-type previews ("quick hits"). v5.19.0 fetched six songs per
 * settled keystroke; 10.1 asks the catalogue's combined search once and keeps
 * songs, artists and albums — the same call the results page makes for the
 * same words, so the request layer's in-flight sharing (services/api/client)
 * turns the typeahead and the All tab into ONE network call.
 *
 * Memoised in a small module cache so backspacing through a query never
 * refetches. Keys are the page's normalised query (trimmed, case- and
 * whitespace-folded), which keeps "arijit" and "arijit " on one entry.
 */
import type { Album, Artist, SearchResults, Song } from '@/types';
import { searchAll } from '@/services/api/saavn';

export const QUICK_LIMIT = 6;
export const QUICK_ARTISTS = 3;
export const QUICK_ALBUMS = 3;
export const QUICK_CACHE_MAX = 50;
export const QUICK_TTL_MS = 5 * 60_000;

export interface QuickHits {
  songs: Song[];
  artists: Artist[];
  albums: Album[];
}

export const NO_HITS: QuickHits = { songs: [], artists: [], albums: [] };

const cache = new Map<string, { at: number; hits: QuickHits }>();

function trim(hits: Partial<QuickHits>): QuickHits {
  return {
    songs: (hits.songs ?? []).slice(0, QUICK_LIMIT),
    artists: (hits.artists ?? []).slice(0, QUICK_ARTISTS),
    albums: (hits.albums ?? []).slice(0, QUICK_ALBUMS),
  };
}

/** Cached preview for `key`, or null when absent/expired. */
export function getCachedQuick(key: string, now = Date.now()): QuickHits | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > QUICK_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Touch: re-insert so the eviction below is least-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.hits;
}

/** Remember a preview (also used to seed from a settled full search). */
export function putCachedQuick(key: string, hits: Partial<QuickHits>, now = Date.now()): void {
  if (!key) return;
  cache.delete(key);
  cache.set(key, { at: now, hits: trim(hits) });
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

type SearchFn = (q: string, opts?: { signal?: AbortSignal; priority?: 'interactive' }) => Promise<SearchResults>;

/**
 * Fetch (or serve from cache) the quick hits for `key`. Interactive
 * allotment: the best endpoint, hedged to the next one if it dawdles. An
 * aborted request rejects and is never cached, so a cancelled keystroke
 * leaves no trace.
 */
export async function fetchQuickResults(
  key: string,
  signal?: AbortSignal,
  search: SearchFn = searchAll,
): Promise<QuickHits> {
  const cached = getCachedQuick(key);
  if (cached) return cached;
  const res = await search(key, { signal, priority: 'interactive' });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const hits = trim(res);
  putCachedQuick(key, hits);
  return hits;
}
