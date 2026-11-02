import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 1.4 — Never repeat, from the built bundle with a mocked catalogue. The
 * listener's history already holds four songs (the heard-set reads them in on
 * its first load), one of which also exists as a DJ remix. With Never repeat
 * on, tapping a song fills the queue with songs that are none of those, in no
 * version. The Queue page shows the mode as a pressed chip.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, i: number, title = `Track ${i}`): Song => ({
  kind: 'song', id: `p${i}`, title, subtitle: `Artist ${i % 8}`, artists: [{ id: `a${i % 8}`, name: `Artist ${i % 8}` }], album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200 + (i % 4) * 30, language: 'telugu', year: String(2000 + (i % 20)), explicit: false, hasLyrics: false, playCount: 90 - i,
});

async function seed(page: Page, baseURL: string, neverRepeat = true): Promise<{ pool: Song[]; heard: Song[]; remix: Song }> {
  const pool = Array.from({ length: 30 }, (_, i) => mk(baseURL, i));
  const heard = pool.slice(0, 4);
  // Another cut of a heard song, under its own catalogue id.
  const remix = { ...mk(baseURL, 99, `${heard[0].title} (DJ Remix)`), id: 'remix-of-heard', artists: heard[0].artists, subtitle: heard[0].subtitle };
  // With the mode off (the control), the catalogue offers mostly heard songs, so the first stretch
  // must bring some back whatever order this page's session picks; with it on, every song is on offer.
  const answer = neverRepeat ? [...pool, remix] : [...heard, remix, pool[4], pool[5]];
  const now = Date.now();
  // Played days ago, and followed by 24 other plays, so neither the recent-play rule (the last
  // 20 plays) nor the three-day cooldown keeps them out: only Never repeat does.
  const fillers = Array.from({ length: 24 }, (_, i) => ({ ...mk(baseURL, 200 + i, `Elsewhere ${i}`), id: `f${i}` }));
  const entries = [
    ...fillers.map((song, i) => ({ song, ts: now - (1 + i) * 3_600_000, completed: true })),
    ...heard.map((song, i) => ({ song, ts: now - (5 + i) * 86_400_000, completed: true })),
  ];
  await page.addInitScript(
    ({ entries, fp, neverRepeat }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, autoplay: true, neverRepeat }, version: 5 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { entries, fp: latestNotesFingerprint(), neverRepeat },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig') return route.fulfill({ json: { mode: 'off' } });
    if (url.pathname === '/api/cat/search') return route.fulfill({ json: { data: { songs: { results: pool.slice(4, 12) }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    if (url.pathname.startsWith('/api/cat/')) {
      if (url.pathname.includes('/search/songs') || url.pathname.includes('/suggestions') || url.pathname.includes('/songs')) return route.fulfill({ json: { data: { results: answer } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return { pool, heard, remix };
}

const queueIds = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []).map((s: { id: string }) => s.id) as string[]);

test('Never repeat: playing a song fills the queue with songs never heard, in no version', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { heard, remix } = await seed(page, baseURL!);
  await page.goto('/search/telugu');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  const tapped = await rows.first().getAttribute('data-song-id');
  await rows.first().click();
  await expect.poll(() => queueIds(page).then((q) => q[0])).toBe(tapped);
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 20_000 }).toBeGreaterThan(3);
  const automatic = (await queueIds(page)).slice(1);
  for (const s of heard) expect(automatic, `heard song ${s.id}`).not.toContain(s.id);
  expect(automatic).not.toContain(remix.id);
  expect(new Set(automatic).size).toBe(automatic.length);

  await page.goto('/queue');
  await expect(page.getByRole('button', { name: 'Never repeat' })).toHaveAttribute('aria-pressed', 'true');
});

test('control: with Never repeat off, the same catalogue does bring heard songs back', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { heard, remix } = await seed(page, baseURL!, false);
  await page.goto('/search/telugu');
  const rows = page.locator('[data-song-id]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect.poll(() => queueIds(page).then((q) => q.length), { timeout: 20_000 }).toBeGreaterThan(3);
  await expect.poll(async () => {
    const automatic = (await queueIds(page)).slice(1);
    return [...heard.map((s) => s.id), remix.id].some((id) => automatic.includes(id));
  }, { timeout: 20_000 }).toBe(true);
});

test('Never repeat appears in Settings → Recommendations', async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.goto('/settings');
  await expect.poll(() => page.evaluate(() => document.body.innerText)).toMatch(/Never repeat/);
  await expect(page.getByRole('switch', { name: 'Never repeat' }).or(page.getByLabel('Never repeat')).first()).toBeVisible();
});
