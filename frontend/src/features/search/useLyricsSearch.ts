/**
 * v5.17.0 — "Search by lyrics" as a query: the lyrics service finds the
 * candidates, the catalogue search resolves each to a playable song.
 * v5.19.0 — the query's abort signal reaches both services, and when the
 * lyrics service has nothing (or fails) a title search of the line stands
 * in, flagged `source: 'catalogue'` for the UI.
 */
import { useQuery } from '@tanstack/react-query';
import { searchSongs } from '@/services/api/saavn';
import { searchLyrics } from '@/services/lyrics/lrclib';
import { catalogueFallback, resolveLyricsHits, type CatalogueSearch, type LyricsMatch } from './lyricsSearch';

export function useLyricsSearch(text: string, enabled: boolean) {
  const q = text.trim();
  return useQuery<LyricsMatch[]>({
    queryKey: ['lyrics-search', q.toLowerCase()],
    enabled: enabled && q.length >= 3,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const search: CatalogueSearch = (query, limit) => searchSongs(query, limit, { signal });
      const matches = await resolveLyricsHits(await searchLyrics(q, { signal }), search).catch((): LyricsMatch[] => []);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (matches.length > 0) return matches;
      return catalogueFallback(q, search);
    },
  });
}
