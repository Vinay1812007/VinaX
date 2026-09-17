import { useDiscoveryStore } from '@/store/discoveryStore';
import { loadProfile } from '@/services/personalization/storage';
import { getSessionVector } from '@/services/personalization/session';
import { activeFestivalMusic } from './festival';
import { buildSessionRecommendationProfile, buildUserRecommendationProfile } from './profiles';
import { useSettingsStore, resolvedRegion, resolveDiscoveryMode } from '@/store/settingsStore';
import { getSessionIntent } from '@/services/personalization/sessionIntent';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import type { Song } from '@/types';
import type { RecommendationContext } from './types';

const SESSION_SALT = Math.floor(Math.random() * 1_000_000);

export function getRecommendationContext(seedSong: Song | null = null, surface: RecommendationContext['surface'] = 'home'): RecommendationContext {
  const settings = useSettingsStore.getState();
  const profile = loadProfile();
  const favorites = useLibraryStore.getState().favorites;
  const history = useHistoryStore.getState().entries;
  const sv = getSessionVector();
  const discoveryMode = resolveDiscoveryMode(settings);
  return {
    salt: SESSION_SALT + useDiscoveryStore.getState().round * 7919,
    profile,
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
    region: resolvedRegion(),
    pinnedLanguages: settings.pinnedLanguages,
    mutedLanguages: settings.mutedLanguages,
    intensity: settings.recommendationIntensity,
    favorites,
    history,
    sessionMood: sv.size >= 2 ? sv.mood : undefined,
    sessionEnergy: sv.size >= 2 ? sv.energy : undefined,
    sessionLanguage: sv.size >= 2 ? sv.language : undefined,
    sessionSize: sv.size,
    festival: activeFestivalMusic(),
    explore: discoveryMode === 'discover',
    discoveryMode,
    sessionIntent: getSessionIntent(),
    seedSong,
    surface,
    userProfile: buildUserRecommendationProfile(profile, favorites, history),
    sessionProfile: buildSessionRecommendationProfile(history.slice(0, sv.size).map((entry) => entry.song)),
    coPlaySeed: seedSong,
  };
}
