import { useQuery } from '@tanstack/react-query';
import { getPodcasts, type PodcastSummary } from '@/services/api/catalog';

/**
 * Podcasts in Search. The catalogue has no podcast search, but its whole
 * show list is small (under a hundred), so Search loads it once, keeps it for
 * hours, and matches show names on the device. A failed load just means no
 * Podcasts group: search never waits on it or shows an error for it.
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const HOUR = 60 * 60 * 1000;

/** Every show the catalogue lists, in its own order. Exported for tests. */
export async function loadAllPodcasts(fetchPage: typeof getPodcasts = getPodcasts): Promise<PodcastSummary[]> {
  const out: PodcastSummary[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await fetchPage(page, PAGE_SIZE).catch(() => (page === 1 ? Promise.reject(new Error('podcasts')) : []));
    let added = 0;
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
      added += 1;
    }
    if (list.length < PAGE_SIZE || added === 0) break;
  }
  return out;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Shows whose name matches the query, best first: the exact name, then names
 * that start with it, then ones containing it, then ones where every typed
 * word starts a word of the name ("kahani express" → "Kahaani Express…" does
 * not match, "kahaani exp" does). Exported for tests.
 */
export function matchPodcasts(all: readonly PodcastSummary[], query: string, limit = 20): PodcastSummary[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const words = q.split(' ').filter(Boolean);
  const scored: Array<{ p: PodcastSummary; score: number; i: number }> = [];
  all.forEach((p, i) => {
    const name = fold(p.name);
    let score = 0;
    if (name === q) score = 4;
    else if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else {
      const nameWords = name.split(' ');
      if (words.every((w) => nameWords.some((n) => n.startsWith(w)))) score = 1;
    }
    if (score) scored.push({ p, score, i });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

/** The catalogue's show list, cached for hours; loads only while `enabled`. */
export function useAllPodcasts(enabled: boolean) {
  return useQuery({
    queryKey: ['search-podcasts-all'],
    queryFn: () => loadAllPodcasts(),
    enabled,
    staleTime: 6 * HOUR,
    gcTime: 12 * HOUR,
    retry: 1,
  });
}

/** Shows matching the query (empty while the list loads or when it failed). */
export function usePodcastMatches(query: string, enabled: boolean, limit = 20): PodcastSummary[] {
  const all = useAllPodcasts(enabled && query.trim().length > 1);
  if (!enabled || !all.data) return [];
  return matchPodcasts(all.data, query, limit);
}
