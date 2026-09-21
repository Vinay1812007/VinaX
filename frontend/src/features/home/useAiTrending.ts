import { useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { curateTrending, type TrendingCuration } from '@/services/ai/trending';
import { getRecommendationContext } from '@/services/recommendation/context';
import { kidModeOn } from '@/services/kidMode';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeatureEnabled } from './useAppConfig';
import { useTrendingNow } from './useHomeShelves';
import { useShelfSafety } from './useShelfSafety';

/**
 * v7.0.1 — "Trending for you". The trending pool is the same catalogue read
 * the old "Trending Now" shelf used; what changes is the order: taste first
 * (on the device), and — when the listener's AI shelves switch and the
 * owner's flag are both on — a bounded AI re-order of that list. One curation
 * per pool: the key is the pool's own identity, so progress ticks, plays and
 * likes do not spend another AI call while Home is open.
 *
 * 7.2.0 — safety is applied when the shelf RENDERS (./useShelfSafety), to the
 * cached curation and to placeholder data alike, so hiding a song or an
 * artist, Kid mode, a muted language or a soft mute takes effect at once.
 * And a pool that only LOST songs keeps its curation: Kid mode and muting a
 * language reload the trending pool without the songs they forbid, and that
 * smaller pool is not a reason to curate (and call the AI) again. Only a pool
 * with songs the last curation never saw gets a new one.
 */
export function useAiTrending() {
  const pool = useTrendingNow();
  const listenerOn = useSettingsStore((s) => s.aiHomeShelves);
  const mode = useSettingsStore((s) => s.discoveryMode);
  const ownerOn = useFeatureEnabled('aiHome');
  const allowAi = listenerOn && ownerOn;
  const allowed = useShelfSafety();
  const ids = (pool.data ?? []).map((s) => s.id);
  const curatedFor = useRef<{ key: string; ids: Set<string> } | null>(null);
  const seen = curatedFor.current;
  if (ids.length && !(seen && ids.every((id) => seen.ids.has(id)))) curatedFor.current = { key: ids.join(','), ids: new Set(ids) };
  const poolKey = curatedFor.current?.key ?? '';
  const curated = useQuery<TrendingCuration>({
    queryKey: ['trending-for-you', poolKey, allowAi, mode],
    enabled: !!pool.data?.length,
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const library = useLibraryStore.getState();
      return curateTrending(pool.data ?? [], getRecommendationContext(null, 'home'), { allowAi, blocked: (song) => isSongBlocked(song, library), hideExplicit: kidModeOn() });
    },
  });
  // Every render, not memoised: the server blocklist is not a store, so the
  // next render after it loads must see it (a list of at most 30 songs).
  const songs = (curated.data?.songs ?? []).filter(allowed);
  return {
    // A curation on screen (cached, or the placeholder while the pool reloads) is never "loading".
    isLoading: !curated.data && (pool.isLoading || (curated.isLoading && !!pool.data?.length)),
    songs,
    by: curated.data?.by ?? ('local' as const),
  };
}
