import { useInfiniteQuery } from '@tanstack/react-query';
import type { Album, Artist, Playlist, Song } from '@/types';
import {
  searchAlbumsPage,
  searchArtistsPage,
  searchPlaylistsPage,
  searchSongsPage,
} from '@/services/api';
import { useSettingsStore } from '@/store/settingsStore';
import { normalizeQuery, rankSongs, relaxedQuery, SEARCH_GC_MS, SEARCH_STALE_MS } from './useSearch';
import { rerankSongs } from './rerank';

type SongPageFetch = (q: string, page: number, limit: number, opts?: { signal?: AbortSignal }) => Promise<Song[]>;

// Queries whose first page only answered in relaxed form → the form that
// worked, so pages 2+ keep asking the same question. Small and bounded.
const rescued = new Map<string, string>();
const RESCUED_MAX = 50;

/** Test hook. */
export function clearRescuedQueries(): void {
  rescued.clear();
}

/**
 * One raw page for the Songs tab. In search mode an empty FIRST page gets the
 * same typo rescue the All tab has ("arijittt singh!!" → "arijit singh"): one
 * retry with the relaxed query, when there is one. Exported for tests.
 */
export async function fetchSongsPage(
  q: string,
  page: number,
  search: boolean,
  signal?: AbortSignal,
  fetchPage: SongPageFetch = searchSongsPage,
): Promise<Song[]> {
  if (!search) return fetchPage(q, page, 25, { signal });
  if (page > 1) return fetchPage(rescued.get(q) ?? q, page, 25, { signal });
  const raw = await fetchPage(q, page, 25, { signal });
  if (raw.length > 0) {
    rescued.delete(q);
    return raw;
  }
  const relaxed = relaxedQuery(q);
  if (!relaxed) return raw;
  const retry = await fetchPage(relaxed, page, 25, { signal });
  if (retry.length > 0) {
    rescued.delete(q);
    rescued.set(q, relaxed);
    while (rescued.size > RESCUED_MAX) {
      const oldest = rescued.keys().next().value;
      if (oldest === undefined) break;
      rescued.delete(oldest);
    }
  }
  return retry;
}

/**
 * Endless song lists for any seed query (search, trending, moods, charts).
 * Pages are taste-ranked individually so already-rendered items never jump.
 *
 * `search: true` = an explicit user query (the Search page's Songs tab):
 * no junk filter, no per-album diversity cap, relevance boost on — and a
 * gentler has-more gate. The old ≥15-survivors gate ran AFTER diversify,
 * which starved infinite scroll on exactly the highest-intent queries
 * (searching an album name caps every page at ~2 survivors — audit P0-6).
 */
export function useInfiniteSongs(query: string, enabled = true, opts?: { search?: boolean }) {
  const q = normalizeQuery(query);
  const search = opts?.search === true;
  return useInfiniteQuery({
    queryKey: ['inf-songs', q, search ? 's' : 'x'],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    // Keep provider pages raw in the cache so filters cannot terminate pagination.
    queryFn: ({ pageParam, signal }) => fetchSongsPage(q, pageParam, search, signal),
    select: (data) => ({
      ...data,
      pages: data.pages.map((raw) => {
        const page = rankSongs(raw, search ? { query: q, searchMode: true } : {});
        return search ? rerankSongs(page, q, useSettingsStore.getState().pinnedLanguages) : page;
      }),
    }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= (search ? 5 : 15) &&
      allPages.length < 40 &&
      !pageAddedNothing(lastPage, allPages)
        ? allPages.length + 1
        : undefined,
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
  });
}

export function useInfiniteAlbums(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useInfiniteQuery({
    queryKey: ['inf-albums', q],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => searchAlbumsPage(q, pageParam, 20, { signal }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 10 && allPages.length < 12 && !pageAddedNothing(lastPage, allPages)
        ? allPages.length + 1
        : undefined,
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
  });
}

/** True when `lastPage` added nothing new. Some mirrors ignore the page param
 *  and serve page 1 forever — that must read as end-of-results, not an
 *  infinite loop of identical fetches. Exported for tests. */
export function pageAddedNothing<T extends { id: string }>(
  lastPage: T[],
  allPages: T[][],
): boolean {
  const prior = new Set(
    allPages
      .slice(0, -1)
      .flat()
      .map((x) => x.id),
  );
  return lastPage.every((x) => prior.has(x.id));
}

/** P2-30 — the Artists tab was hard-capped at 20 results. */
export function useInfiniteArtists(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useInfiniteQuery({
    queryKey: ['inf-artists', q],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => searchArtistsPage(q, pageParam, 20, { signal }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 10 && allPages.length < 12 && !pageAddedNothing(lastPage, allPages)
        ? allPages.length + 1
        : undefined,
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
  });
}

/** P2-30 — twin for the Playlists tab. */
export function useInfinitePlaylists(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useInfiniteQuery({
    queryKey: ['inf-playlists', q],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => searchPlaylistsPage(q, pageParam, 20, { signal }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 10 && allPages.length < 12 && !pageAddedNothing(lastPage, allPages)
        ? allPages.length + 1
        : undefined,
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
  });
}

/** Order-preserving, id-deduped flatten for any paged entity list. */
export function flattenPages<T extends { id: string }>(pages: T[][] | undefined): T[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const item of page) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
}

export function flattenArtistPages(pages: Artist[][] | undefined): Artist[] {
  return flattenPages(pages);
}

export function flattenPlaylistPages(pages: Playlist[][] | undefined): Playlist[] {
  return flattenPages(pages);
}

export function flattenAlbumPages(pages: Album[][] | undefined): Album[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: Album[] = [];
  for (const page of pages) {
    for (const a of page) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
  }
  return out;
}

export function flattenSongPages(pages: Song[][] | undefined): Song[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const page of pages) {
    for (const song of page) {
      if (!seen.has(song.id)) {
        seen.add(song.id);
        out.push(song);
      }
    }
  }
  return out;
}
