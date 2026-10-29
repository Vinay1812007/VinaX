import { useQuery } from '@tanstack/react-query';
import { API_LANGUAGES, getCharts, getFeaturedPlaylists, getNewReleases, getPlaylist, getTrendingSongs } from '@/services/api';
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

/** The catalogue's chart playlists ("Most Searched Songs - Hindi", "Trending Today"…). */
export function useCatalogueCharts() {
  const langs = usePinnedFeedLangs();
  return useQuery<Playlist[]>({
    queryKey: ['catalogue-charts', langs],
    queryFn: ({ signal }) => {
      const feed = feedLanguages(langs);
      return feed.length ? getCharts(feed, FEED_LIMIT, { signal }) : noLanguages();
    },
    staleTime: STALE,
    retry: false,
  });
}

export function useFeaturedPlaylists() {
  const langs = usePinnedFeedLangs();
  return useQuery<Playlist[]>({
    queryKey: ['featured-playlists', langs],
    queryFn: ({ signal }) => {
      const feed = feedLanguages(langs);
      return feed.length ? getFeaturedPlaylists(feed, FEED_LIMIT, { signal }) : noLanguages();
    },
    staleTime: STALE,
    retry: false,
  });
}

/** The albums half of the new-releases feed (the songs half feeds "New releases"). */
export function useNewAlbums() {
  const langs = usePinnedFeedLangs();
  return useQuery<Album[]>({
    queryKey: ['new-albums', langs],
    queryFn: async ({ signal }) => {
      const feed = feedLanguages(langs);
      if (!feed.length) return noLanguages();
      const { albums } = await getNewReleases(feed, FEED_LIMIT, { signal });
      if (!albums.length) throw new Error('no new albums');
      return albums;
    },
    staleTime: STALE,
    retry: false,
  });
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
      // FEED_LIMIT: the same /charts request the Home and Charts shelves make.
      const chart = pickMostSearched(await getCharts(feed, FEED_LIMIT, { signal }), feed[0]);
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
