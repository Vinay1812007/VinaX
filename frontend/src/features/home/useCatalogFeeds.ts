import { useQuery } from '@tanstack/react-query';
import {
  API_LANGUAGES,
  getCharts,
  getFeaturedPlaylists,
  getHomeFeed,
  getNewReleases,
  getPlaylist,
  getTrending,
  getTrendingAlbums,
  getTrendingPlaylists,
  getTrendingSongs,
  type HomeFeed,
  type TrendingFeed,
} from '@/services/api';
import { languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import type { Album, Playlist, Song } from '@/types';

/**
 * 1.3 — the catalogue's own feeds (charts, featured playlists, new albums,
 * the trending and most-searched lists) for the listener's pinned languages.
 * All optional: a miss (the backup source does not know the routes, or the
 * list is empty) is an error with no retry, and the page hides the shelf or
 * falls back to what it did before.
 */

const STALE = 30 * 60_000;
/** One limit for every feed call, so the same request is shared (and memoised) across shelves. */
export const FEED_LIMIT = 20;

/** The pinned languages (up to three, hindi when none) as the feed hooks key them. */
export function usePinnedFeedLangs(): string[] {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  return (pinned.length ? pinned : ['hindi']).slice(0, 3);
}

/**
 * The languages the catalogue's feeds understand. An empty list means "do not
 * ask" — the API would answer in Hindi, which is not what was asked for.
 */
export function feedLanguages(langs: readonly string[]): string[] {
  const known: readonly string[] = API_LANGUAGES;
  return langs.filter((l) => known.includes(l));
}

/** A playlist's line under its title: the source's name says nothing, so the language stands in. */
export function playlistSubtitle(p: Playlist): string {
  if (p.subtitle && !/jiosaavn/i.test(p.subtitle)) return p.subtitle;
  if (p.songCount) return `${p.songCount} songs`;
  return p.language ? `${languageLabel(p.language)} · Playlist` : 'Playlist';
}

function noLanguages(): Promise<never> {
  return Promise.reject(new Error('no catalogue feed for these languages'));
}

function nonEmpty<T>(list: T[], what: string): T[] {
  if (!list.length) throw new Error(`no ${what}`);
  return list;
}

/**
 * 1.3 — Home reads two calls: /home (new releases, charts, featured
 * playlists) and /trending (songs, albums, playlists). Every Home shelf asks
 * with the same path, so the client shares one request and memoises it.
 */
export function homeBundle(langs: string[], signal?: AbortSignal): Promise<HomeFeed> {
  return getHomeFeed(langs, FEED_LIMIT, { signal });
}

export function trendingBundle(langs: string[], signal?: AbortSignal): Promise<TrendingFeed> {
  return getTrending(langs, FEED_LIMIT, { signal });
}

/** A Home shelf from one section of a bundle; a missing or empty section is a miss. */
function useBundleList<T>(key: string, pick: (langs: string[], signal?: AbortSignal) => Promise<T[]>) {
  const langs = usePinnedFeedLangs();
  return useQuery<T[]>({
    queryKey: [key, langs],
    queryFn: async ({ signal }) => {
      const feed = feedLanguages(langs);
      return feed.length ? nonEmpty(await pick(feed, signal), key) : noLanguages();
    },
    staleTime: STALE,
    retry: false,
  });
}

/** Home: the catalogue's chart playlists ("Most Searched Songs - Hindi", "Trending Today"…), from /home. */
export function useCatalogueCharts() {
  return useBundleList<Playlist>('catalogue-charts', async (l, signal) => (await homeBundle(l, signal)).charts);
}

/** Home: featured playlists, from /home. */
export function useFeaturedPlaylists() {
  return useBundleList<Playlist>('featured-playlists', async (l, signal) => (await homeBundle(l, signal)).featuredPlaylists);
}

/** Home: the albums half of the new releases (the songs half feeds "New releases"), from /home. */
export function useNewAlbums() {
  return useBundleList<Album>('new-albums', async (l, signal) => (await homeBundle(l, signal)).newAlbums);
}

/** Home: trending playlists, from /trending. */
export function useTrendingPlaylists() {
  return useBundleList<Playlist>('trending-playlists', async (l, signal) => (await trendingBundle(l, signal)).playlists);
}

/**
 * The Charts page's longer lists, one route each (/charts, /featured-playlists,
 * /new-releases, /trending/albums, /trending/playlists). One limit, so the
 * Most Searched page shares the /charts request.
 */
export const CHARTS_LIMIT = 50;

export function useChartPlaylists() {
  return useBundleList<Playlist>('charts-page-charts', (l, signal) => getCharts(l, CHARTS_LIMIT, { signal }));
}

export function useChartsFeaturedPlaylists() {
  return useBundleList<Playlist>('charts-page-featured', (l, signal) => getFeaturedPlaylists(l, CHARTS_LIMIT, { signal }));
}

export function useChartsNewAlbums() {
  return useBundleList<Album>('charts-page-new-albums', async (l, signal) => (await getNewReleases(l, CHARTS_LIMIT, { signal })).albums);
}

export function useChartsTrendingAlbums() {
  return useBundleList<Album>('charts-page-trending-albums', (l, signal) => getTrendingAlbums(l, CHARTS_LIMIT, { signal }));
}

export function useChartsTrendingPlaylists() {
  return useBundleList<Playlist>('charts-page-trending-playlists', (l, signal) => getTrendingPlaylists(l, CHARTS_LIMIT, { signal }));
}

/** The trending-songs feed as a full list, in the catalogue's order (Charts, /trending). One limit, one shared request. */
export const TRENDING_LIST_LIMIT = 50;

export function useTrendingFeedSongs(enabled = true) {
  const langs = usePinnedFeedLangs();
  return useQuery<Song[]>({
    queryKey: ['trending-feed-songs', langs],
    queryFn: ({ signal }) => {
      const feed = feedLanguages(langs);
      return feed.length ? getTrendingSongs(feed, TRENDING_LIST_LIMIT, { signal }) : noLanguages();
    },
    enabled,
    staleTime: STALE,
    retry: false,
  });
}

/**
 * The chart playlist named "Most Searched…" — the one in the listener's first
 * language when there are several — or null.
 */
export function pickMostSearched(charts: Playlist[], primary: string | undefined): Playlist | null {
  const most = charts.filter((p) => /^most searched/i.test(p.title));
  return most.find((p) => p.language === primary) ?? most[0] ?? null;
}

/** The songs of the catalogue's "Most Searched Songs" chart playlist (/most-searched). */
export function useMostSearchedFeedSongs(enabled = true) {
  const langs = usePinnedFeedLangs();
  return useQuery<Song[]>({
    queryKey: ['most-searched-feed-songs', langs],
    queryFn: async ({ signal }) => {
      const feed = feedLanguages(langs);
      if (!feed.length) return noLanguages();
      // CHARTS_LIMIT: the same /charts request the Charts page makes.
      const chart = pickMostSearched(await getCharts(feed, CHARTS_LIMIT, { signal }), feed[0]);
      if (!chart) throw new Error('no most-searched chart');
      const { songs } = await getPlaylist(chart.id);
      if (!songs.length) throw new Error('empty most-searched chart');
      return songs;
    },
    enabled,
    staleTime: STALE,
    retry: false,
  });
}
