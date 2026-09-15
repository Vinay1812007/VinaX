import { useQuery } from '@tanstack/react-query';
import { buildRecommendations } from '@/services/recommendation/engine';
import type { Mix } from '@/services/recommendation/types';
import { profileStamp } from '@/services/personalization/storage';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getRecommendationContext } from '@/services/recommendation/context';

// Fresh each app load → shelves rotate between sessions instead of being identical.
export { getRecommendationContext } from '@/services/recommendation/context';

/** All personalized shelves — computed locally, memoized by profile state. */
export function useRecommendations() {
  const round = useDiscoveryStore((s) => s.round);
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const intensity = useSettingsStore((s) => s.recommendationIntensity);
  const explore = useSettingsStore((s) => s.exploreMode);
  return useQuery<Mix[]>({
    queryKey: ['mixes', profileStamp(), new Date().getHours(), pinned, muted, intensity, explore, round],
    queryFn: () => buildRecommendations(getRecommendationContext()),
    staleTime: 10 * 60_000,
  });
}
