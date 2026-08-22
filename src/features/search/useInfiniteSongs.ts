import { useInfiniteQuery } from '@tanstack/react-query';
import type { Album, Song } from '@/types';
import { searchAlbumsPage, searchSongsPage } from '@/services/api';
import { normalizeQuery, rankSongs } from './useSearch';

/**
 * Endless song lists for any seed query (search, trending, moods, charts).
 * Pages are taste-ranked individually so already-rendered items never jump.
 */
export function useInfiniteSongs(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useInfiniteQuery({
    queryKey: ['inf-songs', q],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => rankSongs(await searchSongsPage(q, pageParam, 25)),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 15 && allPages.length < 40 ? allPages.length + 1 : undefined,
    staleTime: 10 * 60_000,
  });
}

export function useInfiniteAlbums(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useInfiniteQuery({
    queryKey: ['inf-albums', q],
    enabled: enabled && q.length > 1,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => searchAlbumsPage(q, pageParam, 20),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 10 && allPages.length < 12 ? allPages.length + 1 : undefined,
    staleTime: 10 * 60_000,
  });
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
