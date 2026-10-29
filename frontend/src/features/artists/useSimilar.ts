import { useQuery } from '@tanstack/react-query';
import type { ArtistRef } from '@/types';
import { getSimilarAlbums, getSimilarArtists } from '@/services/api';

/**
 * 1.3 — the catalogue's similar artists and albums (VinaX Music API). Both
 * reject when the API is down or has nothing; the pages then keep what they
 * showed before (artist) or show nothing (album).
 */

const STALE_MS = 30 * 60_000;
const RELATED_MAX = 12;

export function useSimilarArtistsOf(id: string | undefined) {
  return useQuery({
    queryKey: ['artist-similar', id],
    queryFn: ({ signal }) => getSimilarArtists(id!, RELATED_MAX, { signal }),
    enabled: !!id,
    staleTime: STALE_MS,
    retry: false,
  });
}

export function useSimilarAlbumsOf(id: string | undefined) {
  return useQuery({
    queryKey: ['album-similar', id],
    queryFn: ({ signal }) => getSimilarAlbums(id!, RELATED_MAX, { signal }),
    enabled: !!id,
    staleTime: STALE_MS,
    retry: false,
  });
}

/**
 * The artist page's related artists: the first source that has any (the
 * catalogue's similar list, then the artist payload's, then the artists
 * credited on their songs), without the artist themself or id-less entries.
 */
export function pickRelatedArtists(selfId: string, sources: Array<ArtistRef[] | null | undefined>, max = RELATED_MAX): ArtistRef[] {
  for (const list of sources) {
    const seen = new Set<string>();
    const out = (list ?? []).filter((a) => !!a.id && !!a.name && a.id !== selfId && !seen.has(a.id) && !!seen.add(a.id));
    if (out.length) return out.slice(0, max);
  }
  return [];
}
