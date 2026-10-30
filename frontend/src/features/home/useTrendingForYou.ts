import { useMemo } from 'react';
import { getRecommendationContext } from '@/services/recommendation/context';
import { orderTrendingForYou } from '@/services/recommendation/trendingForYou';
import { kidModeOn } from '@/services/kidMode';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTrendingNow } from './useHomeShelves';
import { useShelfSafety } from './useShelfSafety';

/**
 * "Popular picks for you": the trending pool the old "Trending Now" shelf
 * read, put in the listener's order on the device (taste first).
 *
 * Safety is applied when the shelf RENDERS (./useShelfSafety), so hiding a
 * song or an artist, Kid mode, a muted language or a soft mute takes effect
 * at once.
 */
export function useTrendingForYou() {
  const pool = useTrendingNow();
  const mode = useSettingsStore((s) => s.discoveryMode);
  const allowed = useShelfSafety();
  const ordered = useMemo(() => {
    if (!pool.data?.length) return [];
    const library = useLibraryStore.getState();
    return orderTrendingForYou(pool.data, getRecommendationContext(null, 'home'), { blocked: (song) => isSongBlocked(song, library), hideExplicit: kidModeOn() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode` is the re-order trigger: the scorer reads it from the store
  }, [pool.data, mode]);
  // Every render, not memoised: the server blocklist is not a store, so the
  // next render after it loads must see it (a list of at most 30 songs).
  return { isLoading: pool.isLoading, songs: ordered.filter(allowed) };
}
