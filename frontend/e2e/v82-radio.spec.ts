import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 8.2 from the built bundle with a mocked catalogue: AI Radio is one tap from
 * Home and starts endless radio from a mood; the Queue's Smart Queue switch is
 * the existing "DJ builds every queue" setting, and "Refresh up next" is there.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const TITLES = ['Soft melody', 'Party blast', 'Dance mass', 'Calm night', 'Mid tempo', 'Feel good', 'Rain song', 'Evening tune', 'Road trip', 'Slow love', 'Bright day', 'Night drive'];
const mk = (base: string, i: number): Song => ({
  kind: 'song', id: `r${i}`, title: TITLES[i % TITLES.length], subtitle: `Artist ${i % 5}`, artists: [{ id: `a${i % 5}`, name: `Artist ${i % 5}` }], album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200 + (i % 4) * 30, language: 'telugu', year: String(1995 + i * 2), explicit: false, hasLyrics: false, playCount: 50 - i,
});

async function seed(page: Page, baseURL: string, opts: { queue: Song[] } = { queue: [] }): Promise<Song[]> {
  const pool = Array.from({ length: 12 }, (_, i) => mk(baseURL, i));
  const now = Date.now();
  const entries = pool.slice(0, 4).map((song, i) => ({ song, ts: now - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ pool, entries, fp, queue }) => {
      // Seed once: a later navigation must see what the page itself saved (the Smart Queue test reloads into Settings).
      if (!localStorage.getItem('vinax.settings.v1')) localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiDj: false, autoplay: true, djTakeover: true }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: pool.slice(0, 2), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
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

const queueIds = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []).map((s: { id: string }) => s.id) as string[]);

test('AI Radio is one tap from Home and a mood starts endless radio', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pool = await seed(page, baseURL!);
  await page.goto('/');
  const shortcuts = page.getByRole('group', { name: 'Shortcuts' });
  await expect(shortcuts).toBeVisible({ timeout: 20_000 });
  await shortcuts.getByRole('button', { name: 'AI Radio' }).click();
  await expect(page.getByRole('heading', { name: 'AI Radio', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Start Melody radio' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Playing AI Radio: Melody' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 15_000 }).toBeGreaterThan(0);
  const q = await queueIds(page);
  expect(pool.some((s) => s.id === q[0])).toBe(true);
  await page.screenshot({ path: 'test-results/v82-ai-radio-390.png' });
});

test('Smart Queue is the existing DJ setting, explained, and Refresh up next is on the queue', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const listed = Array.from({ length: 3 }, (_, i) => mk(baseURL!, i));
  await seed(page, baseURL!, { queue: listed });
  await page.goto('/queue');
  const sw = page.getByRole('switch', { name: 'Smart Queue' });
  await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Refresh up next' })).toBeVisible();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.goto('/settings');
  const setting = page.getByRole('switch', { name: 'DJ builds every queue' });
  await expect(setting.first()).toHaveAttribute('aria-checked', 'false');
});
