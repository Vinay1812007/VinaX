import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 9.0 Home from the built bundle, in a real browser, with mocked APIs:
 *  - the refresh policy: leaving Home and coming back inside the half hour
 *    reuses the AI design and the rotating shelves (no new /api/curate
 *    shelves call, no new catalogue searches); "Refresh Home" builds again;
 *  - progressive disclosure: the wider catalogue mounts (and asks the
 *    catalogue) only after "Show more for you";
 * (Safety at render — a hide leaving every shelf and the opening at once — is
 * pinned by pages/HomePage.test.tsx, where the store can be driven directly.)
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, id: string, title: string, artist: string): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 5,
});

async function seed(page: Page, baseURL: string): Promise<{ curate: string[]; searches: string[] }> {
  const songs = Array.from({ length: 16 }, (_, i) => mk(baseURL, `s${i}`, `Song ${i}`, `Artist ${i % 5}`));
  const stored = songs.map((s) => ({ ...s, artists: s.artists }));
  const entries = stored.slice(0, 8).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ stored, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiHomeShelves: true }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: stored.slice(0, 3), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { stored, entries, fp: latestNotesFingerprint() },
  );
  const curate: string[] = [];
  const searches: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'flags') return route.fulfill({ json: { flags: { aiHome: true } } });
    if (url.pathname === '/api/curate') {
      const body = route.request().postDataJSON() as { task?: string };
      curate.push(body?.task ?? '?');
      if (body?.task === 'shelves') {
        return route.fulfill({ json: { data: { sections: [
          { title: 'Late-night Telugu melodies', query: 'telugu late night melodies', why: 'Slow songs for the hour.' },
          { title: 'Artist 1 on repeat', query: 'artist 1 hits', why: 'Your most played voice this week.' },
        ] } } });
      }
      return route.fulfill({ json: { error: 'invalid_output' }, status: 502 });
    }
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? url.pathname).toLowerCase();
      searches.push(`${q}|${url.searchParams.get('page') ?? '1'}`);
      return route.fulfill({ json: { data: { results: songs } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return { curate, searches };
}

/** Step down the page the way a listener does, so visibility-mounted blocks load. */
async function scrollDown(page: Page, steps = 16): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate(() => document.querySelector('#main-content')?.scrollBy(0, 500));
    await page.waitForTimeout(150);
  }
}

test('returning to Home inside the half hour reuses the design and the shelves; Refresh Home builds again', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = await seed(page, baseURL!);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  await scrollDown(page);
  await expect.poll(() => seen.curate.filter((t) => t === 'shelves').length, { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500);
  const before = new Set(seen.searches);
  const designs = seen.curate.filter((t) => t === 'shelves').length;

  // Away and back, client-side, the way a listener moves around.
  await page.getByRole('link', { name: 'Library' }).first().click();
  await page.waitForURL('**/library');
  await page.getByRole('link', { name: 'Home' }).first().click();
  await page.waitForSelector('.vx-hero');
  await scrollDown(page);
  await page.waitForTimeout(1500);
  expect(seen.curate.filter((t) => t === 'shelves').length).toBe(designs);
  // Rotating shelves were answered from the cache: no search Home had not asked before.
  expect(seen.searches.filter((q) => !before.has(q))).toEqual([]);

  // An explicit refresh designs again.
  await page.getByRole('button', { name: 'Refresh Home' }).click();
  await expect.poll(() => seen.curate.filter((t) => t === 'shelves').length, { timeout: 20_000 }).toBe(designs + 1);
});

test('the wider catalogue mounts (and asks the catalogue) only after "Show more for you"', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const seen = await seed(page, baseURL!);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  await scrollDown(page, 24);
  await page.waitForTimeout(1000);
  const text = () => page.evaluate(() => document.body.innerText);
  expect(await text()).not.toMatch(/Mood playlists|Trending artists|More for you/);
  expect(seen.searches.some((q) => /trending albums/.test(q))).toBe(false);
  await page.getByRole('button', { name: /Show more for you/ }).click();
  await scrollDown(page, 24);
  await expect.poll(() => seen.searches.some((q) => /trending albums|underrated|new .* artists|artists 20/.test(q)), { timeout: 20_000 }).toBe(true);
});
