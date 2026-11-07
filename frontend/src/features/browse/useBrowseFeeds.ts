import { useQuery } from '@tanstack/react-query';
import { getNewReleases, type NewReleasesFeed } from '@/services/api';
import { CHARTS_LIMIT, feedLanguages, usePinnedFeedLangs } from '@/features/home/useCatalogFeeds';

/**
 * The New Releases page's list: the catalogue's /new-releases (albums and
 * songs) in the listener's music languages. Shares the Charts page's limit,
 * so both pages use one request. Rejects when the catalogue has nothing —
 * the page then falls back to the search-based "new this week" songs.
 */
export function useNewReleasesPage() {
  const langs = usePinnedFeedLangs();
  return useQuery<NewReleasesFeed>({
    queryKey: ['new-releases-page', langs],
    queryFn: ({ signal }) => {
      const feed = feedLanguages(langs);
      if (!feed.length) return Promise.reject(new Error('no catalogue feed for these languages'));
      return getNewReleases(feed, CHARTS_LIMIT, { signal, priority: 'interactive' });
    },
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** Lists merged in order, each item once (by id). */
export function mergeById<T extends { id: string }>(...lists: Array<readonly T[] | undefined>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
