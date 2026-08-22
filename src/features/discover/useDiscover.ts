import { useQuery } from '@tanstack/react-query';
import { searchSongs, searchPlaylists } from '@/services/api';
import { moodSeed } from '@/constants/seeds';
import { rankSongs } from '@/features/search/useSearch';

export function useMoodSongs(moodId: string, language: string | null) {
  return useQuery({
    queryKey: ['mood', moodId, language],
    queryFn: async () => rankSongs(await searchSongs(moodSeed(moodId, language), 25)),
    enabled: moodId !== '',
    staleTime: 15 * 60_000,
  });
}

export function useEditorialPlaylists(seed: string) {
  return useQuery({
    queryKey: ['editorial', seed],
    queryFn: () => searchPlaylists(seed, 12),
    staleTime: 30 * 60_000,
  });
}
