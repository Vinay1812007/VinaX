import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { dailyBucket } from './dailyRotation';

const STALE = 4 * 60 * 60_000;
const YEAR = new Date().getFullYear();

/**
 * Genre catalog surfaced as chip-cards on the home page. `path` is a
 * predictable `/search/…` deep link so no extra data is required to render
 * the chip. `useGenreShelf` fetches when a full shelf is requested.
 */
export const GENRE_SHELVES: Array<{ id: string; label: string; query: string }> = [
  { id: 'pop', label: 'Pop', query: `pop hits ${YEAR}` },
  { id: 'hiphop', label: 'Hip Hop', query: 'hip hop rap hits' },
  { id: 'rock', label: 'Rock', query: 'rock hits' },
  { id: 'indie', label: 'Indie', query: 'indie music hits' },
  { id: 'edm', label: 'EDM', query: 'edm electronic dance hits' },
  { id: 'classical', label: 'Classical', query: 'classical instrumental' },
  { id: 'jazz', label: 'Jazz', query: 'jazz music hits' },
  { id: 'country', label: 'Country', query: 'country music hits' },
  { id: 'kpop', label: 'K-Pop', query: 'k-pop hits' },
  { id: 'lofi', label: 'Lo-fi', query: 'lofi chill beats' },
  { id: 'telugu', label: 'Telugu Hits', query: 'telugu hit songs' },
  { id: 'tamil', label: 'Tamil Hits', query: 'tamil hit songs' },
  { id: 'bollywood', label: 'Bollywood', query: 'bollywood hit songs' },
  { id: 'punjabi', label: 'Punjabi', query: 'punjabi hit songs' },
];

/** Factory hook — one genre → 12 ranked songs. Keyed on daily bucket. */
export function useGenreShelf(genre: string, limit = 12) {
  const bucket = dailyBucket();
  return useQuery<Song[]>({
    queryKey: ['genre-shelf', genre, bucket],
    enabled: genre.length > 0,
    staleTime: STALE,
    queryFn: async () => rankSongs(await searchSongs(genre, Math.max(limit, 12))).slice(0, limit),
  });
}
