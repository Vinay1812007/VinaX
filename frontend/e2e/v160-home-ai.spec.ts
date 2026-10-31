import { test, expect, type Page } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 1.4 — the AI Home Builder, from the built bundle with mocked APIs:
 *  - an answer in time: Home shows the AI's shelves in its order, each with
 *    its title and one-line "why", the new "Made for right now" shelf filled
 *    from the catalogue, and no accessibility violations;
 *  - an answer that comes too late: Home uses its own order, and the late
 *    layout never replaces it — Home does not move while it is on screen.
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

const AI_LAYOUT = (generation: number) => ({
  layout: {
    generation,
    blocks: [
      { type: 'quick', title: 'Pick up where you left', reason: 'Your recent favourites, one tap away' },
      { type: 'rightnow', title: 'Late night melodies', reason: 'Soft songs for a slow night', query: 'late night melodies', mood: 'chill', language: 'telugu' },
      { type: 'loved', title: 'Songs you keep', reason: 'The ones you come back to at night' },
      { type: 'personal', title: 'Made from your taste', reason: 'Mixes built from what you love' },
      { type: 'moods', title: 'Moods for tonight', reason: 'Calm moods for the evening' },
      { type: 'feed', title: 'Keep listening', reason: 'More music, endlessly' },
    ],
  },
  model: 'test',
});

async function seed(page: Page, baseURL: string, aiDelayMs: number): Promise<{ aiCalls: () => number }> {
  const songs = Array.from({ length: 16 }, (_, i) => mk(baseURL, `s${i}`, `Song ${i}`, `Artist ${i % 5}`));
  const entries = songs.slice(0, 8).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ stored, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false }, version: 5 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: stored.slice(0, 3), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { stored: songs, entries, fp: latestNotesFingerprint() },
  );
  let aiCalls = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig') return route.fulfill({ json: { mode: 'off' } });
    if (url.pathname === '/api/ai/home-layout') {
      aiCalls += 1;
      const body = JSON.parse(route.request().postData() ?? '{}') as { generation: number };
      await new Promise((r) => setTimeout(r, aiDelayMs));
      return route.fulfill({ json: AI_LAYOUT(body.generation) }).catch(() => undefined);
    }
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: songs } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return { aiCalls: () => aiCalls };
}

// The device's shelves, in order. The personal engine's own section (its marker is
// `personal-engine`) stays first whenever the AI does not place it, so it is left out here.
const markers = (page: Page) => page.$$eval('[data-home-block]', (els) => els.map((e) => e.getAttribute('data-home-block')).filter((k) => !!k && k !== 'personal-engine') as string[]);

test('the AI builds Home: its shelves, order, titles and one-line reasons', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = await seed(page, baseURL!, 200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pick up where you left' })).toBeVisible({ timeout: 15_000 });
  expect(seen.aiCalls()).toBe(1);
  await expect(page.getByText('Your recent favourites, one tap away')).toBeVisible();
  // The AI's own shelf, filled from the catalogue.
  await expect(page.getByRole('heading', { name: 'Late night melodies' })).toBeVisible();
  await expect(page.getByText('Soft songs for a slow night')).toBeVisible();
  const order = await markers(page);
  expect(order.slice(0, 4)).toEqual(['quick', 'rightnow', 'loved', 'personal']);
  expect(order).not.toContain('charts');
  await expect(page.getByRole('button', { name: 'Not interested' }).first()).toBeVisible();
  // The AI's own pieces: every shelf head it wrote, and the "right now" shelf.
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).include('.vxh-ai-head').include('[data-home-block="rightnow"] + *').analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' / ')}`)).toEqual([]);
});

test('a late answer falls back to Home’s own order, and Home never moves while it is visible', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, baseURL!, 4_000);
  await page.goto('/');
  await page.waitForSelector('[data-home-block="quick"]', { state: 'attached', timeout: 15_000 });
  const first = await markers(page);
  expect(first[0]).toBe('quick');
  // Well past the late answer: nothing on screen has moved, and no AI title appeared.
  await page.waitForTimeout(5_000);
  expect(await markers(page)).toEqual(first);
  await expect(page.getByRole('heading', { name: 'Pick up where you left' })).toHaveCount(0);
});
