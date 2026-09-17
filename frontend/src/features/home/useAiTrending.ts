import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { curateTrending, type TrendingCuration } from '@/services/ai/trending';
import { getRecommendationContext } from '@/services/recommendation/context';
import { kidModeOn } from '@/services/kidMode';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeatureEnabled } from './useAppConfig';
import { useTrendingNow } from './useHomeShelves';

/**
 * v7.0.1 — "Trending for you". The trending pool is the same catalogue read
 * the old "Trending Now" shelf used; what changes is the order: taste first
 * (on the device), and — when the listener's AI shelves switch and the
 * owner's flag are both on — a bounded AI re-order of that list. One curation
 * per pool: the key is the pool's own identity, so progress ticks, plays and
 * likes do not spend another AI call while Home is open.
 */
export function useAiTrending() {
  const pool = useTrendingNow();
  const listenerOn = useSettingsStore((s) => s.aiHomeShelves);
  const mode = useSettingsStore((s) => s.discoveryMode);
  const ownerOn = useFeatureEnabled('aiHome');
  const allowAi = listenerOn && ownerOn;
  const poolKey = (pool.data ?? []).map((s) => s.id).join(',');
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
  return {
    isLoading: pool.isLoading || (curated.isLoading && !!pool.data?.length),
    songs: curated.data?.songs ?? [],
    by: curated.data?.by ?? ('local' as const),
  };
}
