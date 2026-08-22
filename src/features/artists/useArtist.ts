import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getArtist, getArtistTopSongs } from '@/services/api';

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

/** Endless artist catalog, sorted by popularity upstream. Page is 0-based. */
export function useInfiniteArtistSongs(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['inf-artist-songs', id],
    enabled: !!id,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getArtistTopSongs(id!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= 10 && allPages.length < 30 ? allPages.length : undefined,
    staleTime: 10 * 60_000,
  });
}
