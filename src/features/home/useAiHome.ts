import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { getAiHomeSections } from '@/services/ai/home';
import { biasUnseenFirst, loadRecentHomeIds, recordRecentHomeIds, reorderByShelfMood, rotatePage } from '@/features/home/homeVariety';
import { loadProfile, profileStamp } from '@/services/personalization/storage';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';

export interface AiHomeShelf {
  title: string;
  songs: Song[];
}

/**
 * Refresh rules for the AI-personalized Home:
 *  - every time you open the Home tab -> a fresh per-mount visit nonce (regenerates)
 *  - morning <-> evening switch        -> dayKey() (half-day)
 *  - your taste changes                -> profileStamp()
 *  - you change languages              -> pinned
 */

/** Refreshes by half-day so morning vs evening differ. */
function dayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/**
 * AI-personalized Home: the AI designs titled sections from your taste + time of
 * day, then each is resolved to songs. Cached per half-day; only runs once you
 * have some listening history. Empty when the AI isn't configured.
 */
export function useAiHome() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const hasTaste = useHistoryStore((s) => s.entries.length > 0);
  // New nonce on every mount → opening the Home tab rebuilds the sections.
  const [visitNonce] = useState(() => Date.now());
  return useQuery<AiHomeShelf[]>({
    queryKey: ['ai-home', visitNonce, dayKey(), profileStamp(), pinned],
    enabled: hasTaste,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: 'always',
    queryFn: async () => {
      const profile = loadProfile();
      const h = new Date().getHours();
      const timeOfDay = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
      const entries = useHistoryStore.getState().entries;
      const counts = new Map<string, { label: string; n: number }>();
      for (const e of entries) {
        const cur = counts.get(e.song.id);
        if (cur) cur.n += 1;
        else counts.set(e.song.id, { label: `${e.song.title} — ${e.song.subtitle}`, n: 1 });
      }
      const topSongs = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((x) => x.label);
      const ctx = {
        topArtists: topArtists(profile, 10).map((a) => a.affinity.name),
        topLanguages: topLanguages(profile, 4).map((l) => l.id),
        topSongs,
        preferredLanguages: pinned,
        freshnessSeed: visitNonce,
        timeOfDay,
        recentlyPlayed: entries.slice(0, 10).map((e) => `${e.song.title} — ${e.song.subtitle}`),
        // Package C3 — hand-tuned dials ride along in the stringified context.
        tasteDials: sliderDialLines(getSliders(profile)),
      };
      const sections = await getAiHomeSections(ctx);
      if (!sections.length) return [];
      // Songs Home surfaced across recent visits — bias each shelf away from
      // them (soft) so consecutive opens don't re-serve the same rows.
      const seenIds = new Set(loadRecentHomeIds());
      const results = await Promise.allSettled(
        sections.map(async (sec, idx) => {
          // Rotate upstream pages by the per-mount visit nonce (was date%3, which
          // repeated for days) so every Home open pulls a fresh page slice.
          const pg = rotatePage(sec.query, visitNonce, idx, 3);
          const raw = rankSongs(await searchSongsPage(sec.query, pg, 18));
          const onLang = pinned.length ? raw.filter((s) => s.language != null && pinned.includes(s.language)) : raw;
          // A9 — sink mood-clashing picks so the shelf reads to its title, then
          // prefer songs not shown lately. Both are stable, so relevance holds.
          const onMood = reorderByShelfMood(sec.title, onLang);
          const songs = biasUnseenFirst(onMood, seenIds).slice(0, 12);
          return { title: sec.title, songs };
        }),
      );
      const shelves = results
        .filter((r): r is PromiseFulfilledResult<AiHomeShelf> => r.status === 'fulfilled' && r.value.songs.length >= 4)
        .map((r) => r.value);
      // Remember what this visit surfaced so the next open leans elsewhere.
      recordRecentHomeIds(shelves.flatMap((s) => s.songs.map((x) => x.id)));
      return shelves;
    },
  });
}
