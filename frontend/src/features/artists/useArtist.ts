import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getArtist, getArtistTopSongs } from '@/services/api';
import type { ArtistSongOrder } from '@/services/api/saavn';
import type { Song } from '@/types';
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
  maxPages = 30,
): number | undefined {
  return lastPage.length >= 10 && allPages.length < maxPages && !pageAddedNothing(lastPage, allPages)
    ? allPages.length
    : undefined;
}

/** Endless artist catalog, sorted upstream (popularity by default). Page is 0-based. */
/** `maxPages`: 30 pages (300 songs) on the artist page; the All songs page goes much further. */
export function useInfiniteArtistSongs(id: string | undefined, order: ArtistSongOrder = 'popularity', maxPages = 30) {
  return useInfiniteQuery({
    queryKey: order === 'popularity' ? ['inf-artist-songs', id] : ['inf-artist-songs', id, order],
    enabled: !!id,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getArtistTopSongs(id!, pageParam, order),
    getNextPageParam: (last: Song[], all: Song[][]) => artistSongsNextPage(last, all, maxPages),
    staleTime: 10 * 60_000,
  });
}
