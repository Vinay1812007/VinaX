import { useEffect, useMemo, useState } from 'react';
import type { Song } from '@/types';
import { useDailyMix } from '@/features/home/useDailyMix';
import { useTrendingNow } from '@/features/home/useHomeShelves';
import { localDateKey, pickDailyFavorite, useBecauseYouLiked } from '@/features/home/useBecauseYouLiked';
import { useUnlimitedFeed } from '@/features/home/useUnlimitedFeed';
import { useShelfSafety } from '@/features/home/useShelfSafety';
import { flattenSongPages } from '@/features/search/useInfiniteSongs';
import { useLibraryStore } from '@/store/libraryStore';
import { exposureLedger } from '@/services/recommendation/exposure';
import { appendFeed, interleave } from './feed';

/** Endless pages fetched for one visit at most (24 songs each, before filtering). */
const MAX_PAGES = 40;

/**
 * 10.1 Flow — the songs, from the recommendation sources the listener
 * already has and no new backend route:
 *
 *  - the Daily mix and Trending now: the two lists Home's opening shows, so a
 *    listener arriving from Home gets them from the query cache with no
 *    request at all;
 *  - "because you liked" a favourite (seed fixed for the visit, so a like
 *    inside Flow does not start a new request);
 *  - the endless Home feed, page by page, once the listener nears the end
 *    (see <FlowEndless/>), so the first paint never waits on it.
 *
 * Songs met elsewhere lately (played, queued, skipped) are left out and songs
 * only shown elsewhere go after fresh ones — one ledger read per visit.
 */
export function useFlowFeed() {
  const allowed = useShelfSafety();
  const daily = useDailyMix();
  const trending = useTrendingNow();
  const [likedSeed] = useState(() => pickDailyFavorite(useLibraryStore.getState().favorites, localDateKey()));
  const liked = useBecauseYouLiked(likedSeed);
  const [ledger] = useState(() => exposureLedger());
  const [endless, setEndless] = useState<Song[]>([]);
  const [feed, setFeed] = useState<Song[]>([]);

  useEffect(() => {
    setFeed((prev) => appendFeed(prev, interleave([daily.data, liked.data, trending.data]), { allowed, ledger }));
  }, [daily.data, liked.data, trending.data, allowed, ledger]);
  useEffect(() => {
    if (endless.length) setFeed((prev) => appendFeed(prev, endless, { allowed, ledger }));
  }, [endless, allowed, ledger]);

  // A song forbidden since it joined (hidden from its menu, Kid mode on) leaves at once.
  const songs = useMemo(() => feed.filter(allowed), [feed, allowed]);
  const starting = daily.isLoading || trending.isLoading;
  return { songs, starting, onEndless: setEndless };
}

/**
 * The endless source, mounted only once Flow needs it (so it costs nothing at
 * first paint). While `need` holds it keeps fetching the next page — a page
 * that adds nothing new (all repeats) simply fetches another.
 */
export function FlowEndless({ need, onSongs }: { need: boolean; onSongs: (songs: Song[]) => void }) {
  const feed = useUnlimitedFeed();
  const pages = feed.data?.pages;
  const count = pages?.length ?? 0;
  useEffect(() => {
    if (need && !feed.isFetching && feed.hasNextPage && count < MAX_PAGES) void feed.fetchNextPage();
  }, [need, feed, count]);
  useEffect(() => {
    if (pages) onSongs(flattenSongPages(pages));
  }, [pages, onSongs]);
  return null;
}
