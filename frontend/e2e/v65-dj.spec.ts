import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v6.5 from the built bundle with a mocked catalogue: tapping a song in a
 * list starts that song alone and the DJ builds the continuation; "Tune this
 * queue" keeps what played and rebuilds the rest; Settings shows the switch.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const TITLES = ['Party blast', 'Soft melody', 'Dance mass', 'Calm night', 'Mid tempo', 'Feel good', 'Rain song', 'Evening tune', 'Road trip', 'Slow love', 'Bright day', 'Night drive'];
const mk = (base: string, i: number): Song => ({
  kind: 'song', id: `p${i}`, title: TITLES[i % TITLES.length], subtitle: `Artist ${i % 5}`, artists: [{ id: `a${i % 5}`, name: `Artist ${i % 5}` }], album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200 + (i % 4) * 30, language: 'telugu', year: String(1995 + i * 2), explicit: false, hasLyrics: false, playCount: 50 - i,
});

async function seed(page: Page, baseURL: string, opts: { queue: Song[] } = { queue: [] }): Promise<Song[]> {
  const pool = Array.from({ length: 12 }, (_, i) => mk(baseURL, i));
  const now = Date.now();
  const entries = pool.slice(0, 4).map((song, i) => ({ song, ts: now - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ pool, entries, fp, queue }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiDj: false, autoplay: true }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: pool.slice(0, 2), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      // Init scripts run on every navigation: never overwrite a queue the app has since built.
      if (!localStorage.getItem('vinax.player.v1')) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue, index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { pool, entries, fp: latestNotesFingerprint(), queue: opts.queue },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/cat/search') return route.fulfill({ json: { data: { songs: { results: pool }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    if (url.pathname.startsWith('/api/cat/')) {
      if (url.pathname.includes('/search/songs') || url.pathname.includes('/suggestions')) return route.fulfill({ json: { data: { results: pool } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return pool;
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
const queueIds = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []).map((s: { id: string }) => s.id) as string[]);

test('tapping a song in a list seeds the DJ instead of playing the list', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, baseURL!);
  await page.goto('/search/telugu');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  const second = rows.nth(1);
  const id = await second.getAttribute('data-song-id');
  await second.click();
  // The tapped song starts alone…
  await expect.poll(() => queueIds(page).then((q) => q[0])).toBe(id);
  // …and the DJ's continuation follows it (from the mocked suggestions), never the tapped list in order.
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 15_000 }).toBeGreaterThan(1);
  const q = await queueIds(page);
  expect(q[0]).toBe(id);
  expect(q.slice(1)).not.toContain(id);
  await page.screenshot({ path: 'test-results/v65-dj-takeover-1280.png' });
});

test('Tune this queue keeps the current song and rebuilds what follows; Settings shows the switch', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pool = await seed(page, baseURL!);
  await page.goto('/queue');
  // Nothing queued yet: the empty state.
  await expect.poll(() => bodyText(page)).toMatch(/Queue is empty/);
  await page.goto('/search/telugu');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 15_000 }).toBeGreaterThan(1);
  const before = await queueIds(page);
  await page.goto('/queue');
  await expect(page.getByRole('group', { name: 'Tune this queue' })).toBeVisible();
  await expect.poll(() => bodyText(page)).toMatch(/builds around what/i);
  await page.getByRole('button', { name: 'Tune queue: More chill' }).click();
  await expect(page.getByRole('button', { name: 'Tune queue: More chill' })).toHaveAttribute('aria-pressed', 'true');
  // The current song stays first; the tail is rebuilt.
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 15_000 }).toBeGreaterThan(1);
  const after = await queueIds(page);
  expect(after[0]).toBe(before[0]);
  expect(pool.some((s) => s.id === after[1])).toBe(true);
  await page.screenshot({ path: 'test-results/v65-tune-390.png' });
  await page.goto('/settings');
  await expect.poll(() => bodyText(page)).toMatch(/DJ builds every queue/);
  const sw = page.getByRole('switch', { name: 'DJ builds every queue' }).or(page.getByLabel('DJ builds every queue'));
  await expect(sw.first()).toBeVisible();
});
