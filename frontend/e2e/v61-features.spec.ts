import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v6.1 listener features, driven from seeded local state with every /api
 * call answered `{}` (catalogue searches) or a fixed payload (song lookups
 * for the import review). Covers: Backup Center preview + merge restore +
 * undo, import review, in-playlist search / multi-select / undo, smart
 * collections, and the Stats estimate labels — at phone and desktop widths
 * in light, dark and AMOLED themes, with screenshots under test-results/.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const mk = (base: string, id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: { id: 'al1', name: 'Album One' },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 5, ...extra,
});

function library(base: string) {
  const songs = [
    mk(base, 's1', 'Samajavaragamana', 'Sid Sriram', { duration: 240, year: '2019' }),
    mk(base, 's2', 'Naatu Naatu', 'Rahul Sipligunj', { duration: 220, year: '2022' }),
    mk(base, 's3', 'Kesariya', 'Arijit Singh', { language: 'hindi', duration: 268, year: '2022' }),
    mk(base, 's4', 'Long Raga', 'Ilaiyaraaja', { duration: 900, year: '1990' }),
  ];
  const now = Date.now();
  const entries = [
    { song: songs[0], ts: now - 3_600_000, completed: true, listenedSec: 233 },
    { song: songs[2], ts: now - 2 * 3_600_000, completed: false },
    { song: songs[1], ts: now - 40 * 86_400_000, completed: true },
  ];
  return { songs, entries };
}

async function seed(page: Page, baseURL: string, theme: 'dark' | 'light' | 'amoled'): Promise<void> {
  const { songs, entries } = library(baseURL);
  await page.addInitScript(
    ({ songs, entries, theme, fp }) => {
      if (localStorage.getItem('v61-seeded')) return;
      localStorage.setItem('v61-seeded', '1');
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'], festivalSkins: false }, version: 3 }));
      localStorage.setItem('vinax.library.v1', JSON.stringify({
        state: {
          favorites: [songs[0], songs[2]], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [],
          collections: [
            { id: 'c1', name: 'Road trip', createdAt: 1, songs: [songs[0], songs[1], songs[3]] },
            { id: 'c2', name: 'Chill', createdAt: 2, songs: [songs[2]] },
          ],
        },
        version: 0,
      }));
      localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries }, version: 0 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { songs, entries, theme, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/')) {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      // The import review's lookups: exact match for Kesariya, nothing for the rest.
      if (q.includes('kesariya')) return route.fulfill({ json: { data: { results: [mk(url.origin, 'k1', 'Kesariya', 'Arijit Singh')] } } });
      return route.fulfill({ json: { data: { results: [] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const SIZES = [
  { width: 390, height: 844, theme: 'light' as const },
  { width: 1440, height: 1000, theme: 'dark' as const },
  { width: 390, height: 844, theme: 'amoled' as const },
];

for (const size of SIZES) {
  const tag = `${size.width}-${size.theme}`;

  test(`collection search, multi-select and undo (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/collection/c1');
    await expect(page.locator('h1', { hasText: 'Road trip' })).toBeVisible();
    await page.fill('#collection-search', 'naatu');
    await expect.poll(() => bodyText(page)).toMatch(/1 song match/);
    await expect(page.locator('.glass-card', { hasText: 'Samajavaragamana' })).toHaveCount(0);
    await page.fill('#collection-search', '');
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByLabel('Select Naatu Naatu').check();
    await page.getByLabel('Select Long Raga').check();
    await expect.poll(() => bodyText(page)).toMatch(/2 selected/);
    await page.screenshot({ path: `test-results/v61-collection-select-${tag}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => bodyText(page)).toMatch(/Removed 2 songs/);
    await expect.poll(() => bodyText(page)).toMatch(/1 song\b/);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => bodyText(page)).toMatch(/3 songs/);
    // Move two songs into "Chill", then undo that too.
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByLabel('Select Naatu Naatu').check();
    await page.selectOption('#collection-target', 'c2');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(() => bodyText(page)).toMatch(/Moved 1 song to “Chill”/);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => bodyText(page)).toMatch(/3 songs/);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test(`smart collection with live preview (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/library');
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByRole('dialog', { name: 'New smart collection' })).toBeVisible();
    await page.fill('#smart-name', 'Telugu favourites');
    await page.getByRole('button', { name: 'Telugu' }).click();
    await page.getByRole('button', { name: 'Favourites only' }).click();
    await expect.poll(() => bodyText(page)).toMatch(/1 of 4 local songs/);
    await expect(page.getByRole('dialog', { name: 'New smart collection' }).locator('b', { hasText: 'Samajavaragamana' })).toBeVisible();
    await page.screenshot({ path: `test-results/v61-smart-sheet-${tag}.png` });
    await page.getByRole('button', { name: 'Create smart collection' }).click();
    await expect.poll(() => bodyText(page)).toMatch(/Telugu favourites/);
    await expect.poll(() => bodyText(page)).toMatch(/1 song right now/);
    // DOM-level click: at desktop widths the "Created …" toast can sit over the card.
    await page.locator('a[href^="/smart/"]').first().evaluate((a) => (a as HTMLElement).click());
    await expect(page.locator('h1', { hasText: 'Telugu favourites' })).toBeVisible();
    await expect.poll(() => bodyText(page)).toMatch(/Telugu · favourites/);
    expect(await noHorizontalScroll(page)).toBe(true);
    // Reload: the definition persisted and still evaluates.
    await page.reload();
    await expect.poll(() => bodyText(page)).toMatch(/1 song right now/);
  });

  test(`import review step (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/library');
    await page.getByRole('button', { name: 'Import from text' }).click();
    await page.fill('#import-playlist-name', 'Reviewed');
    await page.fill('#import-playlist-text', 'Kesariya — Arijit Singh\nSome Unknown Song — Nobody');
    await page.getByRole('button', { name: 'Find songs' }).click();
    await expect.poll(() => bodyText(page), { timeout: 20_000 }).toMatch(/1 matched · 0 closest matches · 1 not found/);
    await expect(page.getByText('Matched', { exact: true })).toBeVisible();
    await expect(page.getByText('Not found', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Original' }).last().click();
    await expect(page.locator('pre', { hasText: 'Some Unknown Song — Nobody' })).toBeVisible();
    await page.screenshot({ path: `test-results/v61-import-review-${tag}.png` });
    await page.getByRole('button', { name: /^Save 1 song$/ }).click();
    await expect.poll(() => bodyText(page)).toMatch(/Reviewed/);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}').state.collections.length as number)).toBe(3);
  });

  test(`backup center preview, merge restore and undo (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog', { name: 'Backup Center' })).toBeVisible();
    await expect.poll(() => bodyText(page)).toMatch(/2 favourites · 2 playlists/);
    await expect.poll(() => bodyText(page)).toMatch(/Downloaded audio and download paths/);
    await page.screenshot({ path: `test-results/v61-backup-center-${tag}.png` });
    // A backup from "another device": one new favourite, one new playlist, a bookmark.
    const extra = mk(baseURL!, 'x9', 'Extra Song', 'Someone Else');
    const file = {
      format: 'vinax-backup', schemaVersion: 2, app: 'vinax', appVersion: '6.1.0', exportedAt: new Date().toISOString(),
      categories: {
        library: { 'vinax.library.v1': { state: { favorites: [extra], collections: [{ id: 'c9', name: 'From elsewhere', createdAt: 3, songs: [extra] }], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 } },
        bookmarks: { 'vinax.bookmarks.v1': { state: { marks: { s1: [42] } }, version: 0 } },
      },
    };
    await page.getByRole('dialog', { name: 'Backup Center' }).locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await expect.poll(() => bodyText(page)).toMatch(/In file: 1 favourite · 1 playlist/);
    await expect.poll(() => bodyText(page)).toMatch(/On this device: 2 favourites · 2 playlists/);
    await page.getByRole('button', { name: /^Merge 2 categories$/ }).click();
    await page.waitForURL(/settings/);
    await expect.poll(() => page.evaluate(() => {
      const lib = JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}').state;
      return `${lib.favorites.length}/${lib.collections.length}`;
    }), { timeout: 15_000 }).toBe('3/3');
    // Undo is offered in the same tab and puts the old data back.
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('button', { name: 'Undo that restore' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo that restore' }).click();
    await expect.poll(() => page.evaluate(() => {
      const lib = JSON.parse(localStorage.getItem('vinax.library.v1') ?? '{}').state;
      return `${lib.favorites.length}/${lib.collections.length}`;
    }), { timeout: 15_000 }).toBe('2/2');
  });

  test(`stats labels estimates and measured minutes (${tag})`, async ({ page, baseURL }) => {
    await page.setViewportSize(size);
    await seed(page, baseURL!, size.theme);
    await page.goto('/stats');
    await expect.poll(() => bodyText(page)).toMatch(/LISTENED \(EST\.\)/);
    await expect.poll(() => bodyText(page)).toMatch(/≈/);
    await page.screenshot({ path: `test-results/v61-stats-${tag}.png`, fullPage: true });
    await page.goto('/settings');
    await expect.poll(() => bodyText(page)).toMatch(/@tester/);
    await expect.poll(() => bodyText(page)).toMatch(/Confirmed by the service/);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}
