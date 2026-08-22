
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { languageLabel } from '@/constants/languages';

const YEAR = new Date().getFullYear();

const SEED_TEMPLATES: Array<(l: string) => string> = [
  (l) => `${l} superhit songs`,
  (l) => `top ${l} songs ${YEAR}`,
  (l) => `best ${l} hits`,
  (l) => `${l} romantic hits`,
  (l) => `${l} dance hits`,
  (l) => `${l} melody songs`,
  (l) => `${l} top charts`,
  (l) => `${l} party songs`,
  (l) => `${l} sad emotional songs`,
  (l) => `${l} love songs ${YEAR}`,
  (l) => `${l} hits ${YEAR - 1}`,
  (l) => `${l} classic evergreen hits`,
  (l) => `${l} folk hits`,
  (l) => `${l} workout energetic songs`,
  (l) => `${l} chill lofi songs`,
  (l) => `${l} latest trending songs`,
];

/**
 * Endless home feed: each page pulls from a rotating (seed x language x upstream
 * page) matrix, so scrolling never runs out. A random per-LOAD offset means
 * every hard refresh starts the feed somewhere different (fresh home on
 * reload). Pages are deduped by id downstream (flattenSongPages).
 *
 * The offset is a module singleton, NOT per-mount state (audit P0-1): a
 * per-mount seed changed the query key on every navigation back to Home,
 * which threw away all loaded pages, refetched a DIFFERENT feed, and dumped
 * the user at the top. Now back-navigation returns to the exact same feed
 * (and the pages come straight from the query cache).
 */
let visitSeed: number | null = null;
function getVisitSeed(): number {
  if (visitSeed === null) visitSeed = Math.floor(Math.random() * 100000);
  return visitSeed;
}

export function useUnlimitedFeed() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const languages = pinned.length ? pinned : ['hindi'];
  const visit = getVisitSeed();

  return useInfiniteQuery({
    queryKey: ['unlimited-feed', languages, visit],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const combos = SEED_TEMPLATES.length * languages.length;
      const p = pageParam + visit; // offset so each refresh differs
      const template = SEED_TEMPLATES[p % SEED_TEMPLATES.length];
      const language = languages[Math.floor(p / SEED_TEMPLATES.length) % languages.length];
      const upstreamPage = (Math.floor(p / combos) % 6) + 1; // cycle upstream pages 1..6
      const seed = template(languageLabel(language).toLowerCase());
      try {
        const hidden = new Set(useLibraryStore.getState().hiddenSongIds);
        return rankSongs(await searchSongsPage(seed, upstreamPage, 24)).filter((x) => !hidden.has(x.id));
      } catch {
        return [] as Song[]; // a dead seed never ends the feed
      }
    },
    // Truly unlimited: the (seed x language x page) matrix rotates forever and
    // duplicates are filtered downstream, so there is always a next page.
    getNextPageParam: (_last, all) => all.length,
    staleTime: 10 * 60_000,
  });
}
