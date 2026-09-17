import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getArtist, getArtistTopSongs } from '@/services/api';
import { pageAddedNothing } from '@/features/search/useInfiniteSongs';

export function useArtist(id: string | undefined) {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id!),
    enabled: !!id,
  });
}

export function useArtistTopSongs(id: string | undefined) {
  return useQuery({
    queryKey: ['artist-songs', id],
    queryFn: () => getArtistTopSongs(id!),
    enabled: !!id,
  });
}

/** Next 0-based page, or undefined at the end. A mirror that ignores the page
 *  param repeats page 1 — that reads as end-of-results. Exported for tests. */
export function artistSongsNextPage<T extends { id: string }>(
  lastPage: T[],
  allPages: T[][],
): number | undefined {
  return lastPage.length >= 10 && allPages.length < 30 && !pageAddedNothing(lastPage, allPages)
    ? allPages.length
    : undefined;
}

/** Endless artist catalog, sorted by popularity upstream. Page is 0-based. */
export function useInfiniteArtistSongs(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['inf-artist-songs', id],
    enabled: !!id,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getArtistTopSongs(id!, pageParam),
    getNextPageParam: artistSongsNextPage,
    staleTime: 10 * 60_000,
  });
}
