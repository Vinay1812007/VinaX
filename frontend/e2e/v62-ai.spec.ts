import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v6.2 AI features from the built bundle with mocked APIs: the "Designed for
 * you" Home block appears only when the owner flag allows it and the AI
 * answers, its queries hit the catalogue, and Settings exposes the switches.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
// Distinct albums: shelf ranking keeps at most two songs per album, as a real catalogue answer would have.
const mk = (base: string, id: string, title: string, artist: string): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: `al-${id}`, name: `Album ${id}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 5,
});

async function seed(page: Page, baseURL: string, opts: { aiHomeFlag: boolean; aiAnswers: boolean }): Promise<{ curateTasks: string[]; queries: string[] }> {
  const songs = Array.from({ length: 12 }, (_, i) => mk(baseURL, `s${i}`, `Song ${i}`, `Artist ${i % 3}`));
  const entries = songs.slice(0, 6).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ songs, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: songs.slice(0, 3), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      // Only the AI block should be left to load below the fold: hide the rest.
      localStorage.setItem('vinax.home.design.v1', JSON.stringify({ title: 'Test', description: 'd', order: ['quick', 'aihome', 'personal'], hidden: ['personal', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'] }));
    },
    { songs, entries, fp: latestNotesFingerprint() },
  );
  const curateTasks: string[] = [];
  const queries: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'flags') return route.fulfill({ json: { flags: { aiHome: opts.aiHomeFlag } } });
    if (url.pathname === '/api/curate') {
      const body = route.request().postDataJSON() as { task?: string };
      curateTasks.push(body?.task ?? '?');
      if (body?.task === 'shelves' && opts.aiAnswers) {
        return route.fulfill({ json: { data: { sections: [
          { title: 'Late-night Telugu melodies', query: 'telugu late night melodies', why: 'Slow songs for the hour.' },
          { title: 'Artist 1 on repeat', query: 'artist 1 hits', why: 'Your most played voice this week.' },
        ] } } });
      }
      return route.fulfill({ json: { error: 'invalid_output' }, status: 502 });
    }
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      queries.push(q);
      if (q.includes('late night') || q.includes('artist 1')) return route.fulfill({ json: { data: { results: songs.slice(q.includes('artist') ? 6 : 0, q.includes('artist') ? 12 : 6) } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return { curateTasks, queries };
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test('Designed for you renders the AI shelves from the catalogue when the flag allows', async ({ page, baseURL }) => {
  const seen = await seed(page, baseURL!, { aiHomeFlag: true, aiAnswers: true });
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => document.querySelector('#main-content')?.scrollTo(0, 1e9));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  }
  // The block label is rendered upper-case by CSS, so innerText reads "DESIGNED FOR YOU".
  await expect.poll(() => bodyText(page), { timeout: 20_000, message: `curate=${JSON.stringify(seen.curateTasks)}` }).toMatch(/designed for you/i);
  await expect.poll(() => bodyText(page)).toMatch(/Late-night Telugu melodies/);
  await expect.poll(() => bodyText(page)).toMatch(/Artist 1 on repeat/);
  expect(seen.curateTasks).toContain('shelves');
  expect(seen.queries.some((q) => q.includes('late night'))).toBe(true);
  await page.screenshot({ path: 'test-results/v62-ai-home-1280.png', fullPage: true });
});

test('the owner flag hides the block and stops the AI request entirely', async ({ page, baseURL }) => {
  const seen = await seed(page, baseURL!, { aiHomeFlag: false, aiAnswers: true });
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  expect(await bodyText(page)).not.toMatch(/designed for you/i);
  expect(seen.curateTasks.filter((t) => t === 'shelves')).toEqual([]);
});

test('an AI failure leaves Home unchanged and Settings shows the switches', async ({ page, baseURL }) => {
  await seed(page, baseURL!, { aiHomeFlag: true, aiAnswers: false });
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  await page.waitForTimeout(2000);
  expect(await bodyText(page)).not.toMatch(/Late-night Telugu melodies/);
  await page.goto('/settings');
  await expect.poll(() => bodyText(page)).toMatch(/AI DJ/);
  await expect.poll(() => bodyText(page)).toMatch(/AI-designed shelves on Home/);
  const dj = page.getByRole('switch', { name: 'AI DJ' }).or(page.getByLabel('AI DJ'));
  await expect(dj.first()).toBeVisible();
});
