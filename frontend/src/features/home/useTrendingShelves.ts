import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Album, Song } from '@/types';
import { searchAlbums, searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { dailyBucket } from './dailyRotation';
import type { ArtistCard } from './useYourArtists';

const YEAR = new Date().getFullYear();
const STALE = 4 * 60 * 60_000;

/**
 * 7.2 — where these shelves come from, said plainly: catalogue searches for
 * popular phrases ("trending albums 2026"), ranked on the device. That is the
 * catalogue's own relevance, not evidence from any public chart, so these
 * shelves must never be labelled as one. Verified public charts come only
 * from services/trends (see docs/trends.md).
 */
export const CATALOGUE_SEARCH_PROVENANCE = {
  kind: 'catalogue-search',
  label: 'Popular in the catalogue',
  note: 'Catalogue search results — not a live chart.',
} as const;

/** "Trending Albums" shelf — catalogue album search results for this year's popular albums (not a chart). */
export function useTrendingAlbums() {
  const bucket = dailyBucket();
  const query = useQuery<Album[]>({
    queryKey: ['trending-albums', YEAR, bucket],
    staleTime: STALE,
    queryFn: async () => {
      const albums = await searchAlbums(`trending albums ${YEAR}`, 18);
      return albums.slice(0, 18);
    },
  });
  return { ...query, provenance: CATALOGUE_SEARCH_PROVENANCE };
}

/**
 * "Trending Artists" shelf — artists that appear most often in catalogue song
 * searches for popular phrases across the listener's languages (not a chart).
 * Returns the same `ArtistCard` shape as `useYourArtists` so the same
 * MediaCard round layout works. One song-search pool → aggregate artists by
 * appearance count.
 */
export function useTrendingArtists(limit = 12) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const bucket = dailyBucket();
  const query = useQuery<Song[]>({
    queryKey: ['trending-artists-src', langs, bucket],
    staleTime: STALE,
    queryFn: async () => {
      const batches = await Promise.allSettled(
        langs.map((l) => searchSongsPage(`trending ${l} artists ${YEAR}`, 1, 18)),
      );
      const seen = new Set<string>();
      const pool: Song[] = [];
      for (const b of batches) {
        if (b.status !== 'fulfilled') continue;
        for (const s of b.value) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          pool.push(s);
        }
      }
      return rankSongs(pool);
    },
  });
  const data = useMemo<ArtistCard[]>(() => {
    const songs = query.data ?? [];
    const map = new Map<string, ArtistCard>();
    for (const song of songs) {
      for (const a of song.artists.slice(0, 2)) {
        if (!a.name) continue;
        const key = a.id || a.name.toLowerCase();
        const cur = map.get(key) ?? { id: a.id, name: a.name, image: a.image ?? null, plays: 0 };
        cur.plays += 1;
        if (!cur.image && a.image) cur.image = a.image;
        if (!cur.id && a.id) cur.id = a.id;
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
  }, [query.data, limit]);
  return { ...query, data, provenance: CATALOGUE_SEARCH_PROVENANCE };
}
