/**
 * VinaX has no music provider: no screen asks one for anything, and a device
 * forgets every song it saved on its first open after the change
 * (src/services/storage/purgeMusic.ts).
 */
import { test, expect, type Page } from './support/test';

const PROVIDER = /\/api\/cat\b|\/img\?|saavn|nepotune|b4a\.run/;

function watchProviderCalls(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (PROVIDER.test(r.url())) hits.push(r.url());
  });
  return hits;
}

test('a device forgets its saved songs on the first open', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('vinax.music-purged.v1') !== null) return;
    const song = {
      kind: 'song', id: 'old1', title: 'Forgotten Melody', subtitle: 'Old Artist',
      artists: [{ id: 'a1', name: 'Old Artist' }], album: null, images: [],
      audio: [{ quality: '160kbps', url: 'https://aac.saavncdn.com/x.mp4' }],
      duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: 1,
    };
    localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: [song], playlists: [] }, version: 1 }));
    localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: [song], index: 0 }, version: 1 }));
  });
  await page.goto('/library?e2e-unpurged');
  await expect(page.locator('#main-content')).toBeVisible();
  const left = await page.evaluate(() => ({
    library: localStorage.getItem('vinax.library.v1'),
    player: localStorage.getItem('vinax.player.v1'),
    purged: localStorage.getItem('vinax.music-purged.v1'),
  }));
  expect(left.purged).not.toBeNull();
  expect(left.library ?? '').not.toContain('Forgotten Melody');
  expect(left.player ?? '').not.toContain('Forgotten Melody');
  await expect(page.getByText('Forgotten Melody')).toHaveCount(0);
});

test('Home, Search and Flow ask no music provider for anything', async ({ page }) => {
  const hits = watchProviderCalls(page);
  for (const path of ['/', '/search/telugu', '/flow']) {
    await page.goto(path);
    await expect(page.locator('#main-content')).toBeVisible();
    await page.waitForTimeout(1500);
  }
  expect(hits).toEqual([]);
});
