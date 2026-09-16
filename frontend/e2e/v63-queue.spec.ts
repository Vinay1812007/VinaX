import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v6.3 Queue Builder from the built bundle with a mocked catalogue: the
 * sheet opens from the Queue page, plans a bounded arc from real (mocked)
 * candidates, previews it, and "Play this plan" installs it as the queue.
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

async function seed(page: Page, baseURL: string): Promise<void> {
  const pool = Array.from({ length: 12 }, (_, i) => mk(baseURL, i));
  const now = Date.now();
  const entries = pool.slice(0, 4).map((song, i) => ({ song, ts: now - i * 3_600_000, completed: true }));
  await page.addInitScript(
    ({ pool, entries, fp }) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiDj: false, autoplay: true }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: pool.slice(0, 2), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: [pool[0]], index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { pool, entries, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) {
      // Every song search and every suggestion call answers with the same real-looking pool.
      if (url.pathname.includes('/search/songs') || url.pathname.includes('/suggestions')) return route.fulfill({ json: { data: { results: pool } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
const queueIds = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}').state?.queue ?? []).map((s: { id: string }) => s.id) as string[]);

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`Queue Builder previews an arc and installs it (${size.width}px)`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!);
    await page.goto('/queue');
    await page.getByRole('button', { name: 'Build a queue' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Build a queue' })).toBeVisible();
    await page.getByRole('button', { name: '20 min' }).click();
    await page.getByRole('button', { name: 'Build up' }).click();
    await page.getByRole('button', { name: 'Preview my queue' }).click();
    await expect.poll(() => bodyText(page), { timeout: 30_000 }).toMatch(/\d+ songs · \d+ min · from \d+ candidates/);
    const dialog = page.getByRole('dialog', { name: 'Build a queue' });
    await expect(dialog.getByRole('img', { name: 'Energy arc of the planned queue' })).toBeVisible();
    const rows = await dialog.locator('ol li').count();
    expect(rows).toBeGreaterThanOrEqual(3);
    // Every planned row carries a reason line.
    expect(await dialog.locator('ol li').first().innerText()).toMatch(/energy|mood|favourite|discovery|hand-off/);
    await page.screenshot({ path: `test-results/v63-queue-builder-${size.width}.png` });
    await dialog.getByRole('button', { name: 'Play this plan' }).click();
    await expect.poll(() => queueIds(page), { timeout: 10_000 }).toSatisfy((ids: string[]) => ids.length >= 3);
    const ids = await queueIds(page);
    expect(new Set(ids).size).toBe(ids.length);
    await expect.poll(() => bodyText(page)).toMatch(/Queue/);
  });
}
