import { test, expect, type Page } from '@playwright/test';
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
for (const size of [
  { width: 1440, height: 1000, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' },
]) {
  test(`discovery filters, presets and collections at ${size.width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await setup(page, size.theme);
    await page.goto('/search');
    await expect(page.locator('.search-vibe-grid')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/discovery-${size.width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    const input = page.getByRole('combobox', { name: 'Search music' });
    await input.fill('melody');
    await input.press('Enter');
    await input.press('Tab');
    await page.getByRole('button', { name: 'Songs', exact: true }).click();
    await expect(page.locator('.search-workspace-bar [role=status]')).toContainText('12');
    await page.getByRole('button', { name: /Refine/ }).click();
    await page.getByLabel('Release decade').selectOption('2020');
    await page.getByLabel('Lyrics available', { exact: true }).check();
    await page.getByLabel('Hide explicit', { exact: true }).check();
    await expect(page.locator('.search-workspace-bar [role=status]')).toContainText('2 of 12');
    await page.getByRole('button', { name: '＋ Save search', exact: true }).click();
    await page.getByLabel('Saved search name').fill('Clean lyric favorites');
    await page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
    await page.getByRole('button', { name: '♡ Favorite results', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('vinax.library.v1') || '{}').state.favorites.length,
        ),
      )
      .toBe(2);
    await page.getByRole('button', { name: 'New collection', exact: true }).click();
    await page.getByLabel('Collection name', { exact: true }).fill('Test collection');
    await page.getByRole('button', { name: 'Create collection', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('vinax.library.v1') || '{}').state.collections[0].songs
              .length,
        ),
      )
      .toBe(2);
    await page.goto('/search');
    await page.getByRole('button', { name: /Clean lyric favorites.*melody/ }).click();
    await expect(page.locator('.search-workspace-bar [role=status]')).toContainText('2 of 12');
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(page.locator('.search-song-results')).toHaveClass(/is-compact/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/discovery-results-${size.width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(errors).toEqual([]);
  });
}
test('admin recovery, tasks, drafts, snapshots and saved views persist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'test-token'));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/admin/overview')
      return route.fulfill({
        json: {
          summary: {
            active_now: 24,
            plays_today: 1200,
            dau: 180,
            new_today: 14,
            errors_24h: 12,
            feedback_new: 3,
          },
          topCountries: [],
          topSongs: [],
          newUsersByDay: [],
          playsByDay: [],
        },
      });
    if (url.pathname === '/api/admin/search-analytics')
      return route.fulfill({
        json: {
          total: 500,
          top: [{ query: 'Telugu melodies', count: 45 }],
          zero: [
            { query: '<img src=x onerror=alert(1)>', count: 8 },
            { query: 'misspelled title', count: 4 },
          ],
        },
      });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.goto('/admin/#workspace');
  await expect(page.locator('.ops-metric').first()).toContainText('24');
  await page.getByRole('button', { name: 'Capture comparison snapshot' }).click();
  await expect(page.locator('.ops-metric').first()).toContainText('+0 since snapshot');
  await page.locator('main').evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/admin-workspace.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: /Search quality/ }).click();
  expect(await page.locator('.ops-query img').count()).toBe(0);
  await page
    .locator('.ops-query')
    .first()
    .getByRole('button', { name: 'Watch', exact: true })
    .click();
  await page.locator('.ops-query').first().getByRole('button', { name: 'Mark reviewed' }).click();
  await page.locator('.ops-query').last().getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('tab', { name: /Task board/ }).click();
  await expect(page.locator('.ops-task')).toContainText('Investigate search: misspelled title');
  await page.locator('.ops-task select').selectOption('doing');
  await page.getByLabel('Saved view name').fill('Daily triage');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('tab', { name: /Handover/ }).click();
  await page.getByLabel('Context for your next session').fill('Draft survives switching tabs.');
  await page.getByRole('tab', { name: /Pulse/ }).click();
  await page.getByRole('tab', { name: /Handover/ }).click();
  await expect(page.getByLabel('Context for your next session')).toHaveValue(
    'Draft survives switching tabs.',
  );
  await page.getByRole('button', { name: 'Save notes' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Daily triage', exact: true }).click();
  await expect(page.locator('.ops-task-column').nth(1)).toContainText(
    'Investigate search: misspelled title',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/admin-workspace-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

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
