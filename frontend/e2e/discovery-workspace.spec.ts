import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';
const songs = Array.from({ length: 12 }, (_, i) => ({
  id: `discovery-${i}`,
  name: `Melody ${i + 1}`,
  subtitle: 'Test Artist',
  artists: { primary: [{ id: 'artist', name: 'Test Artist' }] },
  album: { id: 'a', name: 'Summer' },
  image: [{ quality: '500x500', url: '/icons/icon.svg' }],
  duration: i < 6 ? 200 : 350,
  year: i < 6 ? '2024' : '1995',
  language: 'telugu',
  hasLyrics: i < 3,
  explicitContent: i === 0,
  playCount: 100 - i,
}));
async function setup(page: Page, theme: string) {
  await page.addInitScript(
    ({ fp, theme }) => {
      if (localStorage.getItem('discovery-seeded')) return;
      localStorage.setItem('discovery-seeded', '1');
      localStorage.setItem(
        'vinax.settings.v1',
        JSON.stringify({
          state: { theme, pinnedLanguages: ['telugu'], festivalSkins: false },
          version: 2,
        }),
      );
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Alex'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('alex'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    { fp: latestNotesFingerprint(), theme },
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/cat/search/songs'))
      return route.fulfill({ json: { data: { results: songs } } });
    if (url.pathname === '/api/cat/search')
      return route.fulfill({
        json: {
          data: {
            songs: { results: songs },
            albums: { results: [] },
            artists: { results: [] },
            playlists: { results: [] },
          },
        },
      });
    if (url.pathname === '/api/trending-searches')
      return route.fulfill({
        json: { queries: ['Telugu melodies', 'Anirudh', '90s hits', 'Evening chill'] },
      });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}
// 13.8.0 — the admin Operations Workspace this file used to test was removed
// with the console rebuild; the console is covered by e2e/console-*.spec.ts.

test('search fits alongside the persistent player and queue rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page, 'dark');
  await page.addInitScript(() => {
    const queue = Array.from({ length: 6 }, (_, i) => ({
      kind: 'song',
      id: `rail-${i}`,
      title: `Evening Melody ${i + 1}`,
      subtitle: 'Test Artist',
      artists: [],
      album: null,
      images: [{ quality: '500x500', url: '/icons/icon.svg' }],
      audio: [],
      duration: 240,
      language: 'telugu',
      year: '2024',
      explicit: false,
      hasLyrics: false,
      playCount: 1,
    }));
    localStorage.setItem(
      'vinax.player.v1',
      JSON.stringify({ state: { queue, index: 0 }, version: 1 }),
    );
  });
  await page.goto('/search');
  await expect(page.locator('.vx-playing-rail')).toBeVisible();
  await expect(page.locator('.search-vibe-grid')).toBeVisible();
  expect(
    await page.locator('#main-content').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/discovery-with-player.png',
    animations: 'disabled',
    fullPage: true,
  });
});
