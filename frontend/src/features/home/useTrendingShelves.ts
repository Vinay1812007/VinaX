import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Album, Song } from '@/types';
import { searchAlbums, searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { dailyBucket } from './dailyRotation';
import type { ArtistCard } from './useYourArtists';
import { feedLanguages, trendingBundle, usePinnedFeedLangs } from './useCatalogFeeds';

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

/**
 * 1.3 — the catalogue's own trending lists (/trending/albums, /trending/songs).
 * Real trending data from the catalogue, so it may say "trending" — but it is
 * still the catalogue's list, not a public chart, and never labelled as one.
 * Only data that actually came from those routes carries this provenance.
 */
export const CATALOGUE_TRENDING_PROVENANCE = {
  kind: 'catalogue-trending',
  label: 'Trending in the catalogue',
  note: 'The catalogue’s own trending list — not a public chart.',
} as const;

export type ShelfProvenance = typeof CATALOGUE_SEARCH_PROVENANCE | typeof CATALOGUE_TRENDING_PROVENANCE;

interface Sourced<T> {
  items: T;
  provenance: ShelfProvenance;
}

/** The trending feed when it answers for the pinned languages, else the old search — labelled by where it came from. */
async function trendingOrSearch<T extends unknown[]>(langs: string[], feed: (langs: string[]) => Promise<T>, search: () => Promise<T>, signal?: AbortSignal): Promise<Sourced<T>> {
  const known = feedLanguages(langs);
  if (known.length) {
    try {
      const items = await feed(known);
      if (items.length) return { items, provenance: CATALOGUE_TRENDING_PROVENANCE };
    } catch {
      /* the feed is optional: fall back to the search */
    }
  }
  if (signal?.aborted) throw new Error('cancelled');
  return { items: await search(), provenance: CATALOGUE_SEARCH_PROVENANCE };
}

/** "Trending Albums" shelf — the catalogue's trending albums, or (fallback) album search results for this year's popular albums. */
export function useTrendingAlbums() {
  const bucket = dailyBucket();
  const langs = usePinnedFeedLangs();
  const query = useQuery<Sourced<Album[]>>({
    queryKey: ['trending-albums', YEAR, bucket, langs],
    staleTime: STALE,
    queryFn: ({ signal }) =>
      trendingOrSearch(
        langs,
        async (known) => (await trendingBundle(known, signal)).albums.slice(0, 18),
        async () => (await searchAlbums(`trending albums ${YEAR}`, 18)).slice(0, 18),
        signal,
      ),
  });
  return { ...query, data: query.data?.items, provenance: query.data?.provenance ?? CATALOGUE_SEARCH_PROVENANCE };
}

/** The pre-1.3 source of "Trending artists": one song search per language, deduped and ranked. */
async function artistSearchPool(langs: string[]): Promise<Song[]> {
  const batches = await Promise.allSettled(langs.map((l) => searchSongsPage(`trending ${l} artists ${YEAR}`, 1, 18)));
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
}

/**
 * "Trending Artists" shelf — artists that appear most often in the catalogue's
 * trending songs (1.3) or, as the fallback, in catalogue song searches for
 * popular phrases across the listener's languages (not a chart).
 * Returns the same `ArtistCard` shape as `useYourArtists` so the same
 * MediaCard round layout works. One song-search pool → aggregate artists by
 * appearance count.
 */
export function useTrendingArtists(limit = 12) {
  const langs = usePinnedFeedLangs();
  const bucket = dailyBucket();
  const query = useQuery<Sourced<Song[]>>({
    queryKey: ['trending-artists-src', langs, bucket],
    staleTime: STALE,
    queryFn: ({ signal }) =>
      trendingOrSearch(langs, async (known) => rankSongs((await trendingBundle(known, signal)).songs), () => artistSearchPool(langs), signal),
  });
  const data = useMemo<ArtistCard[]>(() => {
    const songs = query.data?.items ?? [];
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
  return { ...query, data, provenance: query.data?.provenance ?? CATALOGUE_SEARCH_PROVENANCE };
}
