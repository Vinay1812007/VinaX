import { useInfiniteQuery } from '@tanstack/react-query';
import type { Album, Artist, Playlist, Song } from '@/types';
import { searchAlbumsPage, searchArtistsPage, searchPlaylistsPage, searchSongsPage } from '@/services/api';
import { normalizeQuery, rankSongs } from './useSearch';

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
    queryFn: async ({ pageParam, signal }) =>
      rankSongs(await searchSongsPage(q, pageParam, 25, { signal }), search ? { query: q, searchMode: true } : {}),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= (search ? 5 : 15) && allPages.length < 40 ? allPages.length + 1 : undefined,
    staleTime: 10 * 60_000,
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
      lastPage.length >= 10 && allPages.length < 12 ? allPages.length + 1 : undefined,
    staleTime: 10 * 60_000,
  });
}

/** True when `lastPage` added nothing new. Some mirrors ignore the page param
 *  and serve page 1 forever — that must read as end-of-results, not an
 *  infinite loop of identical fetches. Exported for tests. */
export function pageAddedNothing<T extends { id: string }>(lastPage: T[], allPages: T[][]): boolean {
  const prior = new Set(allPages.slice(0, -1).flat().map((x) => x.id));
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
    staleTime: 10 * 60_000,
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
    staleTime: 10 * 60_000,
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
