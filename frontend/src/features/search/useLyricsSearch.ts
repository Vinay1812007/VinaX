/**
 * v5.17.0 — "Search by lyrics" as a query: the lyrics service finds the
 * candidates, the catalogue search resolves each to a playable song.
 */
import { useQuery } from '@tanstack/react-query';
import { searchLyrics } from '@/services/lyrics/lrclib';
import { resolveLyricsHits, type LyricsMatch } from './lyricsSearch';

export function useLyricsSearch(text: string, enabled: boolean) {
  const q = text.trim();
  return useQuery<LyricsMatch[]>({
    queryKey: ['lyrics-search', q.toLowerCase()],
    enabled: enabled && q.length >= 3,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => resolveLyricsHits(await searchLyrics(q)),
  });
}
