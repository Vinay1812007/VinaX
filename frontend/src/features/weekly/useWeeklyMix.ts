import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Song } from '@/types';
import type { Mix } from '@/services/recommendation/types';
import { buildRecommendations } from '@/services/recommendation/engine';
import { getRecommendationContext } from '@/services/recommendation/context';
import { getLocal, setLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { useSettingsStore } from '@/store/settingsStore';

/** v2: the week is the discovery mix (songs new to you), not the first 30 songs of every mix. */
const WEEK_VERSION = 2;

interface Cached {
  v?: number;
  week: string;
  langs: string;
  songs: Song[];
}

/** ISO-week key like "2026-W26" — the weekly mix is stable within this. */
import { isoWeekKey } from './weekKey';
export { isoWeekKey };

function saltOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** This week's saved Your Week, or null when there is none for this week and these languages. */
export function readYourWeek(week = isoWeekKey(), langs = useSettingsStore.getState().pinnedLanguages.join(',')): Song[] | null {
  const cached = getLocal<Cached | null>(KEYS.weekly, null);
  return cached && cached.v === WEEK_VERSION && cached.week === week && cached.langs === langs && cached.songs?.length ? cached.songs : null;
}

/**
 * Made for you's "New to you this week" shows the same songs as Your Week:
 * once the week is built, the discovery mix's songs are swapped for it.
 */
export function withYourWeek(mixes: Mix[], week: Song[] | null = readYourWeek()): Mix[] {
  if (!week?.length) return mixes;
  return mixes.map((m) => (m.kind === 'discover-weekly' ? { ...m, songs: week } : m));
}

/**
 * Your Week (/weekly) — the weekly discovery mix: up to 30 songs the listener
 * has never heard, by artists they have never played, topped up from the
 * explore source (services/recommendation/mixes.ts, weekDiscoveries). Seeded
 * by the ISO week so it stays the same all week and refreshes every Monday;
 * cached locally so it is identical across sessions within the week.
 */
export function useWeeklyMix() {
  const week = isoWeekKey();
  const langs = useSettingsStore((s) => s.pinnedLanguages).join(',');
  const queryClient = useQueryClient();
  return useQuery<Song[]>({
    queryKey: ['weekly-mix', week, langs],
    staleTime: Infinity,
    queryFn: async () => {
      const cached = readYourWeek(week, langs);
      if (cached) return cached;
      // The lifetime heard-set (a lazy chunk), so a song played months ago is not "new"
      // either. If it cannot load, the check falls back to the history and profile.
      await import('@/services/recommendation/heardSet').then((m) => m.initHeardSet()).catch(() => undefined);
      // widen 2 adds the explore source in the listener's own languages: the top-up.
      const mixes = await buildRecommendations({ ...getRecommendationContext(), salt: saltOf(week), widen: 2 });
      const songs = mixes.find((m) => m.kind === 'discover-weekly')?.songs ?? [];
      if (songs.length) {
        setLocal(KEYS.weekly, { v: WEEK_VERSION, week, langs, songs } satisfies Cached);
        queryClient.setQueriesData<Mix[]>({ queryKey: ['mixes'] }, (old) => (old ? withYourWeek(old, songs) : old));
      }
      return songs;
    },
  });
}
