import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
  const mode = useSettingsStore((s) => s.discoveryMode);
  // v7.0.0 — the stamp is frozen per mount. It moves on every play, skip and
  // like; keyed live, each one replaced the query while Home was open (the
  // hero swapped, shelves fell back to skeletons, the whole pipeline re-ran).
  // Shelves now pick up new taste on the next Home open or a manual refresh,
  // and a key change keeps the previous shelves on screen while it loads.
  const [stamp] = useState(profileStamp);
  return useQuery<Mix[]>({
    queryKey: ['mixes', stamp, new Date().getHours(), pinned, muted, intensity, mode, round],
    queryFn: () => buildRecommendations(getRecommendationContext()),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}
