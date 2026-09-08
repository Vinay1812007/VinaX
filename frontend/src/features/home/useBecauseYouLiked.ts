import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { getSongSuggestions } from '@/services/api';

/**
 * v5.17.0 — "Because you liked X": one favourite picked deterministically per
 * calendar day (date hash), then the catalog's suggestions for it. Stable all
 * day, fresh tomorrow. Nothing leaves the device except the song id lookup.
 */
export function localDateKey(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function pickDailyFavorite(favorites: Song[], dateKey: string): Song | null {
  if (!favorites.length) return null;
  let h = 0;
  for (const c of dateKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return favorites[h % favorites.length] ?? null;
}

export function useBecauseYouLiked(seed: Song | null) {
  return useQuery({
    queryKey: ['because-liked', seed?.id ?? null],
    enabled: Boolean(seed),
    staleTime: 6 * 60 * 60_000,
    queryFn: async (): Promise<Song[]> => {
      if (!seed) return [];
      const songs = await getSongSuggestions(seed.id, 12);
      return songs.filter((s) => s.id !== seed.id);
    },
  });
}
