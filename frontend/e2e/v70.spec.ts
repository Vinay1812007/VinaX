import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v7.0 from the built bundle with a mocked catalogue:
 *  - a device upgraded from 6.x (settings v3, explore switch on) lands on
 *    Discover, and the three-way control works and persists;
 *  - a song the listener queues by hand goes AHEAD of the recommender's tail;
 *  - the developer breakdown shows selected, passed-over and rejected songs.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const TITLES = ['Party blast', 'Soft melody', 'Dance mass', 'Calm night', 'Mid tempo', 'Feel good', 'Rain song', 'Evening tune', 'Road trip', 'Slow love', 'Bright day', 'Night drive', 'Morning raga', 'City lights'];
const mk = (base: string, i: number, over: Partial<Song> = {}): Song => ({
  kind: 'song', id: `s${i}`, title: TITLES[i % TITLES.length], subtitle: `Artist ${i % 7}`, artists: [{ id: `a${i % 7}`, name: `Artist ${i % 7}` }], album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200 + (i % 4) * 30, language: 'telugu', year: String(2000 + i), explicit: false, hasLyrics: false, playCount: 500 - i, ...over,
});

async function seed(page: Page, baseURL: string, settings: Record<string, unknown> = {}): Promise<Song[]> {
  const pool = [...Array.from({ length: 14 }, (_, i) => mk(baseURL, i)), mk(baseURL, 90, { id: 'muted-one', title: 'Punjabi hit', language: 'punjabi' })];
  const now = Date.now();
  const entries = pool.slice(0, 3).map((song, i) => ({ song, ts: now - (i + 30) * 86_400_000, completed: true }));
  await page.addInitScript(
    ({ pool, entries, fp, settings }) => {
      // A 6.x device: settings envelope v3, no discoveryMode yet.
      if (!localStorage.getItem('vinax.settings.v1')) localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], mutedLanguages: ['punjabi'], festivalSkins: false, aiDj: false, autoplay: true, ...settings }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: pool.slice(0, 2), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { pool, entries, fp: latestNotesFingerprint(), settings },
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

const queue = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []) as Array<{ id: string; language: string; artists: Array<{ name: string }> }>);
const settingsState = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('vinax.settings.v1') ?? '{}') as { version?: number; state?: Record<string, unknown> });

test('a 6.x device with the explore switch on upgrades to Discover; the three-way control persists', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, baseURL!, { exploreMode: true });
  await page.goto('/settings');
  const group = page.getByRole('group', { name: 'Discovery mode' });
  await expect(group.getByRole('button', { name: 'Discover' })).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: 'Familiar' }).click();
  await expect(group.getByRole('button', { name: 'Familiar' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => settingsState(page).then((s) => s.state?.discoveryMode)).toBe('familiar');
  const saved = await settingsState(page);
  expect(saved.version).toBe(4);
  expect(saved.state?.exploreMode).toBe(false);
  expect(saved.state?.pinnedLanguages).toEqual(['telugu']); // nothing else was lost in the migration
  await page.screenshot({ path: 'test-results/v70-discovery-mode-390.png' });
});

test('the built queue obeys the rules, and a hand-queued song goes ahead of the automatic tail', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, baseURL!);
  await page.goto('/search/telugu?debug=recs');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect.poll(() => queue(page).then((q) => q.length), { timeout: 15_000 }).toBeGreaterThan(3);
  const built = await queue(page);
  // Rules: the seed's language only, nothing muted, one entry per song, no lead artist back to back.
  expect(built.every((s) => s.language === 'telugu')).toBe(true);
  expect(new Set(built.map((s) => s.id)).size).toBe(built.length);
  for (let i = 1; i < built.length; i += 1) expect(built[i].artists[0].name).not.toBe(built[i - 1].artists[0].name);

  // Queue a song by hand that is not in the queue yet.
  const queued = new Set(built.map((s) => s.id));
  const count = await rows.count();
  let target: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const id = await rows.nth(i).getAttribute('data-song-id');
    if (id && !queued.has(id) && id !== 'muted-one') { target = id; break; }
  }
  expect(target).not.toBeNull();
  const row = page.locator(`[data-song-id="${target}"]`).first();
  await row.hover();
  await row.getByRole('button', { name: /More options/ }).click();
  await page.getByRole('menuitem', { name: 'Add to queue' }).or(page.getByRole('button', { name: 'Add to queue' })).first().click();
  await expect.poll(() => queue(page).then((q) => q.map((s) => s.id).indexOf(target!))).toBe(1);
  const after = await queue(page);
  expect(after.slice(2).map((s) => s.id)).toEqual(built.slice(1).map((s) => s.id)); // the automatic tail kept its order, behind it

  // Developer breakdown: selected rows, the pipeline trace and the rejected muted song.
  await page.getByRole('button', { name: /recs debug/ }).click();
  await expect(page.getByText(/stages: \d+ gathered/)).toBeVisible();
  await page.getByText(/^rejected ·/).click();
  await expect(page.getByText('muted-language').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/v70-queue-debug-1280.png' });
});
