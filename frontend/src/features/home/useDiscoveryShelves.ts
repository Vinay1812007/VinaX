import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs, searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { useRegion } from '@/features/location/useRegion';
import { trendingSeed } from '@/constants/seeds';
import { dailyBucket, hashString } from './dailyRotation';

const YEAR = new Date().getFullYear();
const STALE = 4 * 60 * 60_000;

/**
 * Pool builder for cross-language discovery shelves. Similar in spirit to
 * `multiLangPool` in useHomeShelves but tuned for discovery — one page per
 * language, deduped, then locally re-ranked. `Promise.allSettled` so one dead
 * language never kills the shelf.
 */
async function pool(langs: string[], seed: (l: string) => string, salt: number): Promise<Song[]> {
  const page = 1 + (salt % 4);
  const batches = await Promise.allSettled(langs.map((l) => searchSongsPage(seed(l), page, 12)));
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    for (const s of b.value) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return rankSongs(out);
}

function pinnedLangs(): string[] {
  const pinned = useSettingsStore.getState().pinnedLanguages;
  return (pinned.length ? pinned : ['hindi']).slice(0, 3);
}

/** "Fresh Finds" — new emerging tracks across the user's pinned languages. */
export function useFreshFinds() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const bucket = dailyBucket();
  return useQuery({
    queryKey: ['fresh-finds', langs, bucket],
    staleTime: STALE,
    queryFn: () => pool(langs, (l) => `new ${l} artists ${YEAR}`, bucket),
  });
}

/** "Hidden Gems" — deep-cut discovery across the user's pinned languages. */
export function useHiddenGems() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const bucket = dailyBucket();
  return useQuery({
    queryKey: ['hidden-gems', langs, bucket],
    staleTime: STALE,
    queryFn: () => pool(langs, (l) => `${l} underrated hidden gems`, bucket + 1),
  });
}

/**
 * "Trending Near You" — regional trending. Uses the resolved region country
 * when available; falls back to a plain "Trending Now" search across pinned
 * languages so the shelf isn't empty for users with region unknown.
 */
export function useTrendingNearYou() {
  const region = useRegion();
  const country = region?.country ?? '';
  const langs = pinnedLangs();
  const bucket = dailyBucket();
  return useQuery({
    queryKey: ['trending-near-you', country, langs, bucket],
    staleTime: STALE,
    queryFn: async (): Promise<Song[]> => {
      if (country) {
        const label = region?.regionLabel || country;
        const songs = await searchSongs(`top trending songs in ${label} ${YEAR}`, 24);
        const ranked = rankSongs(songs);
        if (ranked.length >= 4) return ranked;
      }
      return pool(langs, trendingSeed, bucket + hashString(country || 'none'));
    },
  });
}
