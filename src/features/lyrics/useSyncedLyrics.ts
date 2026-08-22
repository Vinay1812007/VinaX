import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { getLyrics } from '@/services/api';
import { fetchLrclibLyrics, type LyricsResult } from '@/services/lyrics/lrclib';
import { reportLyricMiss } from '@/services/analytics/telemetry';

/**
 * Lyrics resolution chain: LRCLIB synced → LRCLIB plain → upstream wrapper
 * plain. Synced lyrics enable the live-highlight view in the player.
 */
export function useSyncedLyrics(song: Song | null | undefined) {
  return useQuery<LyricsResult | null>({
    queryKey: ['lyrics-v3', song?.id],
    enabled: !!song,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      if (!song) return null;
      const artist = song.artists[0]?.name ?? song.subtitle.split(',')[0] ?? '';
      const fromUpstream = async (): Promise<LyricsResult | null> => {
        try {
          const upstream = await getLyrics(song.id);
          if (upstream.lyrics) return { plain: upstream.lyrics, synced: null, source: 'upstream' };
        } catch {
          /* upstream lyrics missing — normal */
        }
        return null;
      };
      // The upstream orchestrator fails over across several providers and can
      // take tens of seconds when they are degraded — lyrics must never wait
      // that long. The promise keeps running in the background harmlessly.
      const withDeadline = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms))]);
      // When the catalog says the song HAS lyrics, the upstream copy is
      // authoritative (film songs rarely exist on LRCLIB) — but a synced
      // LRCLIB hit still wins over plain text.
      if (song.hasLyrics) {
        const upP = withDeadline(fromUpstream(), 8000, null);
        const lrc = await fetchLrclibLyrics(song.title, artist, song.duration);
        // A synced hit renders NOW — upstream plain text never gates it.
        if (lrc?.synced) return lrc;
        const up = await upP;
        const result = up ?? lrc;
        if (!result) reportLyricMiss(song);
        return result;
      }
      const lrc = await fetchLrclibLyrics(song.title, artist, song.duration);
      if (lrc) return lrc;
      const up = await withDeadline(fromUpstream(), 8000, null);
      if (!up) reportLyricMiss(song);
      return up;
    },
  });
}
