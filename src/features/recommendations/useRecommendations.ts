import { useQuery } from '@tanstack/react-query';
import { buildRecommendations } from '@/services/recommendation/engine';
import type { Mix, RecommendationContext } from '@/services/recommendation/types';
import { loadProfile, profileStamp } from '@/services/personalization/storage';
import { useSettingsStore, resolvedRegion } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';

// Fresh each app load → shelves rotate between sessions instead of being identical.
const SESSION_SALT = Math.floor(Math.random() * 1_000_000);

export function getRecommendationContext(): RecommendationContext {
  const settings = useSettingsStore.getState();
  return {
    salt: SESSION_SALT,
    profile: loadProfile(),
    hour: new Date().getHours(),
    region: resolvedRegion(),
    pinnedLanguages: settings.pinnedLanguages,
    mutedLanguages: settings.mutedLanguages,
    intensity: settings.recommendationIntensity,
    favorites: useLibraryStore.getState().favorites,
    history: useHistoryStore.getState().entries,
  };
}

/** All personalized shelves — computed locally, memoized by profile state. */
export function useRecommendations() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const intensity = useSettingsStore((s) => s.recommendationIntensity);
  return useQuery<Mix[]>({
    queryKey: ['mixes', profileStamp(), new Date().getHours(), pinned, muted, intensity, SESSION_SALT],
    queryFn: () => buildRecommendations(getRecommendationContext()),
    staleTime: 10 * 60_000,
  });
}
