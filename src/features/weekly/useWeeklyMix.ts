import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { buildRecommendations } from '@/services/recommendation/engine';
import { getRecommendationContext } from '@/features/recommendations/useRecommendations';
import { getLocal, setLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { useSettingsStore } from '@/store/settingsStore';

interface Cached {
  week: string;
  langs: string;
  songs: Song[];
}

/** ISO-week key like "2026-W26" — the weekly mix is stable within this. */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function saltOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * "For You This Week" — a personalized 30-track mix built from your taste,
 * seeded by the ISO week so it stays the same all week and refreshes every
 * Monday. Cached locally so it's identical across sessions within the week.
 */
export function useWeeklyMix() {
  const week = isoWeekKey();
  const langs = useSettingsStore((s) => s.pinnedLanguages).join(',');
  return useQuery<Song[]>({
    queryKey: ['weekly-mix', week, langs],
    staleTime: Infinity,
    queryFn: async () => {
      const cached = getLocal<Cached | null>(KEYS.weekly, null);
      if (cached && cached.week === week && cached.langs === langs && cached.songs?.length) return cached.songs;
      const mixes = await buildRecommendations({ ...getRecommendationContext(), salt: saltOf(week) });
      const seen = new Set<string>();
      const songs: Song[] = [];
      for (const m of mixes) {
        for (const s of m.songs) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          songs.push(s);
          if (songs.length >= 30) break;
        }
        if (songs.length >= 30) break;
      }
      if (songs.length) setLocal(KEYS.weekly, { week, langs, songs });
      return songs;
    },
  });
}
