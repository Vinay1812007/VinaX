import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { getLyrics } from '@/services/api';
import { fetchLrclibLyrics, type LyricsResult } from '@/services/lyrics/lrclib';
import { reportLyricMiss } from '@/services/analytics/telemetry';
import { isEpisode } from '@/features/podcasts/paths';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Lyrics resolution chain: LRCLIB synced → LRCLIB plain → upstream wrapper
 * plain. Synced lyrics enable the live-highlight view in the player.
 */
export function useSyncedLyrics(song: Song | null | undefined) {
  const script = useSettingsStore((s) => s.lyricsScript);
  return useQuery<LyricsResult | null>({
    queryKey: ['lyrics-v3', song?.id, script],
    enabled: !!song,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      if (!song) return null;
      // 1.3 — podcast episodes have no lyrics; a title lookup could only find a wrong song.
      if (isEpisode(song)) return null;
      const artist = song.artists[0]?.name ?? song.subtitle.split(',')[0] ?? '';
      const fromUpstream = async (): Promise<LyricsResult | null> => {
        try {
          const upstream = await getLyrics(song.id, { script });
          // 1.3 — the catalogue can match synced lines server-side, which
          // covers listeners whose network blocks lrclib.net.
          if (upstream.lyrics || upstream.synced) {
            return { plain: upstream.lyrics || null, synced: upstream.synced ?? null, source: 'upstream' };
          }
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
      // 1.3 — English letters: only the catalogue can rewrite lyrics (synced
      // lines included), so it goes first; LRCLIB as written is the fallback.
      if (script === 'latin') {
        const up = await withDeadline(fromUpstream(), 8000, null);
        if (up) return up;
        const lrc = await fetchLrclibLyrics(song.title, artist, song.duration);
        if (!lrc) reportLyricMiss(song);
        return lrc;
      }
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
      if (lrc?.synced) return lrc;
      // With LRCLIB plain text already in hand, wait less for a synced upgrade.
      const up = await withDeadline(fromUpstream(), lrc ? 3000 : 8000, null);
      // Synced from the catalogue beats plain text from LRCLIB.
      const result = up?.synced ? up : (lrc ?? up);
      if (!result) reportLyricMiss(song);
      return result;
    },
  });
}
