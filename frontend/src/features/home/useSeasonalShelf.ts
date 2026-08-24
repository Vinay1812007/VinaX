import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useRegion } from '@/features/location/useRegion';
import { dailyBucket } from './dailyRotation';

const STALE = 4 * 60 * 60_000;

interface Season {
  id: string;
  title: string;
  query: string;
}

/**
 * Pick a single seasonal shelf based on the current UTC date and (for
 * monsoon) the resolved country. Returns `null` when nothing matches so the
 * caller renders nothing at all.
 *
 * Priority when multiple could apply: most-specific event wins.
 * - Dec       → Christmas
 * - Feb       → Valentine's
 * - Oct–Nov   → Festival Specials
 * - Jul–Sep IN → Monsoon Melodies
 * - Jun–Aug   → Summer Hits
 * - Fri–Sun ≥17h → Weekend Party (fallback)
 */
export function pickSeason(now: Date, country: string | null | undefined): Season | null {
  const m = now.getUTCMonth(); // 0=Jan
  const dow = now.getUTCDay(); // 0=Sun,5=Fri,6=Sat
  const h = now.getUTCHours();
  if (m === 11) return { id: 'christmas', title: 'Christmas Songs', query: 'christmas holiday songs' };
  if (m === 1) return { id: 'valentine', title: "Valentine's Playlist", query: 'valentine love songs' };
  if (m === 9 || m === 10) return { id: 'festival', title: 'Festival Specials', query: 'festival celebration songs' };
  if (country === 'IN' && m >= 6 && m <= 8) {
    return { id: 'monsoon', title: 'Monsoon Melodies', query: 'monsoon rain hindi songs' };
  }
  if (m >= 5 && m <= 7) return { id: 'summer', title: 'Summer Hits', query: 'summer hits' };
  const weekendEvening = (dow === 5 || dow === 6 || dow === 0) && h >= 17;
  if (weekendEvening) return { id: 'weekend', title: 'Weekend Party', query: 'weekend party hits' };
  return null;
}

export interface SeasonalShelfResult {
  season: Season | null;
  data: Song[] | undefined;
  isLoading: boolean;
}

/** Fetch the one seasonal shelf that matches "now" — or nothing at all. */
export function useSeasonalShelf(): SeasonalShelfResult {
  const region = useRegion();
  const season = pickSeason(new Date(), region?.country);
  const bucket = dailyBucket();
  const query = useQuery<Song[]>({
    queryKey: ['seasonal', season?.id ?? 'none', bucket],
    enabled: Boolean(season),
    staleTime: STALE,
    queryFn: async () => rankSongs(await searchSongs(season!.query, 20)),
  });
  return { season, data: query.data, isLoading: query.isLoading };
}
