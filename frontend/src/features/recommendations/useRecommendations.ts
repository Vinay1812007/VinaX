import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { buildRecommendations } from '@/services/recommendation/engine';
import type { Mix } from '@/services/recommendation/types';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getRecommendationContext } from '@/services/recommendation/context';
import { HOME_TTL_MS, homeGeneration, tasteStamp, useHomeGeneration } from '@/features/home/homeRefresh';

// Fresh each app load → shelves rotate between sessions instead of being identical.
export { getRecommendationContext } from '@/services/recommendation/context';

/**
 * All personalized shelves — computed locally (services/recommendation/engine).
 *
 * 9.0.0 — built once per Home generation and taste stamp
 * (features/home/homeRefresh.ts). v7.0.0 froze the raw profile stamp per
 * mount, which stopped shelves jumping while Home was open but rebuilt the
 * whole pipeline (and its optional AI re-rank) on every return to Home after
 * a single play. Now:
 *   - the taste stamp is coarse (five plays, a like or dislike, a skip
 *     streak, a "Less like this") and read once per visit;
 *   - the hour is the hour the generation started, so crossing an hour while
 *     browsing changes nothing;
 *   - a return inside the half hour with the same stamp is a cache hit;
 *   - pinned / muted languages, intensity, the discovery mode and a new
 *     discovery round rebuild at once, with the previous mixes on screen.
 */
export function useRecommendations() {
  const round = useDiscoveryStore((s) => s.round);
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const intensity = useSettingsStore((s) => s.recommendationIntensity);
  const mode = useSettingsStore((s) => s.discoveryMode);
  const gen = useHomeGeneration();
  const [stamp] = useState(tasteStamp);
  const hour = new Date(homeGeneration().startedAt).getHours();
  return useQuery<Mix[]>({
    queryKey: ['mixes', gen, stamp, hour, pinned, muted, intensity, mode, round],
    queryFn: () => buildRecommendations(getRecommendationContext()),
    staleTime: HOME_TTL_MS,
    gcTime: 2 * HOME_TTL_MS,
    placeholderData: keepPreviousData,
  });
}
