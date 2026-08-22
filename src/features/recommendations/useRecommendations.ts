import { useQuery } from '@tanstack/react-query';
import { buildRecommendations } from '@/services/recommendation/engine';
import type { Mix, RecommendationContext } from '@/services/recommendation/types';
import { loadProfile, profileStamp } from '@/services/personalization/storage';
import { getSessionVector } from '@/services/personalization/session';
import { activeFestivalMusic } from '@/services/recommendation/festival';
import { useSettingsStore, resolvedRegion } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';

// Fresh each app load → shelves rotate between sessions instead of being identical.
const SESSION_SALT = Math.floor(Math.random() * 1_000_000);

export function getRecommendationContext(): RecommendationContext {
  const settings = useSettingsStore.getState();
  // Package A1 — the current-session mood arc from the rolling play window.
  const sv = getSessionVector();
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
    // Only surface the vector once a couple of songs have played, so a
    // single opening track doesn't lock the whole session's mood.
    sessionMood: sv.size >= 2 ? sv.mood : undefined,
    sessionEnergy: sv.size >= 2 ? sv.energy : undefined,
    sessionLanguage: sv.size >= 2 ? sv.language : undefined,
    sessionSize: sv.size,
    // Package A10 — compute the in-season festival once per context build.
    festival: activeFestivalMusic(),
    // Package A4 — the Settings explore toggle (default off).
    explore: settings.exploreMode,
  };
}

/** All personalized shelves — computed locally, memoized by profile state. */
export function useRecommendations() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const intensity = useSettingsStore((s) => s.recommendationIntensity);
  const explore = useSettingsStore((s) => s.exploreMode);
  return useQuery<Mix[]>({
    queryKey: ['mixes', profileStamp(), new Date().getHours(), pinned, muted, intensity, explore, SESSION_SALT],
    queryFn: () => buildRecommendations(getRecommendationContext()),
    staleTime: 10 * 60_000,
  });
}
