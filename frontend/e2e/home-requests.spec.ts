import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * Home request load — measured, not estimated. Counts catalogue calls the
 * Home page makes (a) on first paint with nothing scrolled, (b) after
 * scrolling to the bottom, and (c) with the owner having disabled several
 * shelves. Every /api call is answered with an empty payload so the count
 * reflects what the page ASKS for, not what the catalogue returns.
 *
 * Run with E2E_PRINT_REQUESTS=1 to print the per-endpoint tallies.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const songs = (base: string): Song[] =>
  Array.from({ length: 14 }, (_, i) => ({
    kind: 'song' as const, id: `s${i}`, title: `Song ${i}`, subtitle: `Artist ${i % 4}`,
    artists: [{ id: `a${i % 4}`, name: `Artist ${i % 4}` }], album: { id: `al${i % 3}`, name: `Album ${i % 3}` },
    images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
    duration: 200 + i, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 10,
  }));

async function seed(page: Page, baseURL: string, ownerHidden: string[] | null): Promise<void> {
  const list = songs(baseURL);
  const now = Date.now();
  const entries = Array.from({ length: 30 }, (_, i) => ({ song: list[i % list.length], ts: now - i * 3_600_000, completed: i % 2 === 0 }));
  await page.addInitScript(
    ({ list, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu', 'hindi'] }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: list.slice(0, 5), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      localStorage.removeItem('vinax.home.design.v1');
    },
    { list, entries, fp: latestNotesFingerprint() },
  );
  const tally = new Map<string, number>();
  const queries = new Set<string>();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const key = url.pathname.startsWith('/api/cat/') ? 'catalog' : url.pathname;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      // One LOGICAL search = one distinct query string; the API client walks a
      // ladder of alternative paths/providers per search when a provider
      // answers with an unsupported shape (as this mock does), so raw HTTP
      // counts overstate what the page asked for.
      if (key === 'catalog') {
        const q = (url.searchParams.get('query') ?? url.searchParams.get('q') ?? url.pathname).toLowerCase();
        queries.add(`${q}|p${url.searchParams.get('page') ?? url.searchParams.get('p') ?? '1'}`);
      }
      if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'client') {
        return route.fulfill({ json: ownerHidden ? { homeLayout: { title: 'Owner', description: 'd', order: [], hidden: ownerHidden } } : {} });
      }
      return route.fulfill({ json: {} });
    }
    return route.continue();
  });
  (page as unknown as { __tally: Map<string, number>; __queries: Set<string> }).__tally = tally;
  (page as unknown as { __tally: Map<string, number>; __queries: Set<string> }).__queries = queries;
}

const catalogCount = (page: Page): number => (page as unknown as { __tally: Map<string, number> }).__tally.get('catalog') ?? 0;
const searchCount = (page: Page): number => (page as unknown as { __queries: Set<string> }).__queries.size;

async function settle(page: Page, ms = 2500): Promise<void> {
  // Wait until the catalogue count stops moving for `ms`.
  let last = -1;
  let stable = 0;
  const started = Date.now();
  while (stable < ms && Date.now() - started < 20_000) {
    const n = catalogCount(page);
    if (n === last) stable += 250;
    else { stable = 0; last = n; }
    await page.waitForTimeout(250);
  }
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vx-hero', { timeout: 20_000 });
  await settle(page);
}

const report = (label: string, page: Page): void => {
  const t = (page as unknown as { __tally: Map<string, number> }).__tally;
  const q = (page as unknown as { __queries: Set<string> }).__queries;
  const line = `[home-requests] ${label}: searches=${q.size} catalogHttp=${t.get('catalog') ?? 0} other=${[...t.entries()].filter(([k]) => k !== 'catalog').map(([k, v]) => `${k}:${v}`).join(',')}`;
  if (process.env.E2E_PRINT_REQUESTS) {
    console.log(line);
    console.log('[home-requests] queries: ' + [...q].sort().join(' ; '));
  }
};

test.describe('Home request load', () => {
  test('first paint asks the catalogue for the hero and the first two blocks only', async ({ page, baseURL }) => {
    await seed(page, baseURL!, null);
    await openHome(page);
    report('initial', page);
    const initial = searchCount(page);
    expect(initial).toBeGreaterThan(0);
    // Measured 2026-09-16 on this seed (two pinned languages, 30 plays,
    // five favourites): the untouched HEAD fired 45 logical searches (226
    // HTTP calls through the fallback ladder) before any scroll; with
    // visibility-mounted blocks it is 18 (124). The hero (mixes + daily +
    // trending) and the first two blocks are all that may run unscrolled.
    expect(initial).toBeLessThanOrEqual(24);
    // Scrolling must still load the rest.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i += 1) {
      await page.evaluate(() => document.querySelector('#main-content')?.scrollTo(0, 1e9));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
    }
    await settle(page);
    report('after-scroll', page);
    expect(searchCount(page)).toBeGreaterThan(initial);
  });

  test('owner-disabled shelves never fetch', async ({ page, baseURL }) => {
    await seed(page, baseURL!, ['moods', 'artists', 'albums', 'discovery', 'seasonal', 'daypicks']);
    await openHome(page);
    for (let i = 0; i < 6; i += 1) {
      await page.evaluate(() => document.querySelector('#main-content')?.scrollTo(0, 1e9));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
    }
    await settle(page);
    report('owner-hidden-scrolled', page);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/Mood Playlists|Trending Artists|Trending Albums/);
    // The six hidden blocks account for the mood (6), artists, albums, day
    // picks, seasonal and the whole discovery band — none may be requested.
    // Measured: HEAD still ran all 46 searches with these hidden; now 22.
    expect(searchCount(page)).toBeLessThanOrEqual(30);
    const queries = [...(page as unknown as { __queries: Set<string> }).__queries];
    // Mood-shelf queries by their exact seed phrases — the endless feed's own
    // templates ("party songs", "chill lofi songs") must not count as a hit.
    expect(queries.some((q) => /gym motivation|lofi relax|focus study|soothing ambient|party dance hits|road trip driving|morning fresh|evening relax|rainy day monsoon|feel good happy/.test(q)), 'no mood-shelf query').toBe(false);
    expect(queries.some((q) => /trending albums|artists 2026|underrated|new .* artists/.test(q)), 'no artists/albums/discovery query').toBe(false);
  });
});
