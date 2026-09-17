import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * v7.0.1 from the built bundle, in a real browser:
 *  - scrolling inside the ⋮ song menu (or over its backdrop) never moves the
 *    page behind it — on the player and in a list. jsdom cannot see this: the
 *    cause was AppLayout's wheel rescue forwarding wheels from our own
 *    portalled overlays to <main>;
 *  - the top bar has no search box; Home's actions live in the bar;
 *  - Discover offers Ads on a phone.
 */
const TITLES = ['Samajavaragamana', 'Butta Bomma', 'Ramuloo Ramulaa', 'Inkem Inkem', 'Naatu Naatu', 'Vachinde', 'Rowdy Baby', 'Arabic Kuthu', 'Srivalli', 'Oo Antava', 'Kalaavathi', 'Jai Balayya'];
const mk = (base: string, i: number) => ({
  kind: 'song', id: `s${i}`, title: TITLES[i % TITLES.length], subtitle: `Artist ${i % 6}`,
  artists: { primary: [{ id: `a${i % 6}`, name: `Artist ${i % 6}` }] }, album: { id: `al${i}`, name: `Album ${i}` },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/x.mp4` }],
  duration: 220, language: 'telugu', year: '2022', explicit: false, hasLyrics: false, playCount: 900 - i,
});

async function seed(page: Page, baseURL: string): Promise<void> {
  const pool = Array.from({ length: 12 }, (_, i) => mk(baseURL, i));
  // What the app persists is its own song shape (artists as a flat list); only the API speaks { primary }.
  const stored = pool.map((s) => ({ ...s, artists: s.artists.primary }));
  await page.addInitScript(({ stored, fp }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, aiDj: false, autoplay: true, djTakeover: false }, version: 4 }));
    localStorage.setItem('vinax.library.v1', JSON.stringify({ state: { favorites: stored.slice(0, 2), saved: [], collections: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] }, version: 0 }));
    localStorage.setItem('vinax.history.v1', JSON.stringify({ state: { entries: stored.slice(0, 4).map((song, i) => ({ song, ts: Date.now() - i * 3_600_000, completed: true })) }, version: 0 }));
    if (!localStorage.getItem('vinax.player.v1')) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: stored, index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { stored, fp: latestNotesFingerprint() });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/cat/search') return route.fulfill({ json: { data: { songs: { results: pool }, albums: { results: [] }, artists: { results: [] }, playlists: { results: [] } } } });
    if (url.pathname.startsWith('/api/cat/')) return route.fulfill({ json: { data: { results: url.pathname.includes('search/songs') || url.pathname.includes('suggestions') ? pool : [] } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

/** scrollTop of every scroller on the page that is not the menu itself. */
const pageScroll = (page: Page) => page.evaluate(() =>
  [document.scrollingElement as Element, ...Array.from(document.querySelectorAll('*'))]
    .filter((e) => e && e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible' && !e.closest('[role=menu]'))
    .map((e) => Math.round(e.scrollTop)));

for (const where of [{ name: 'the player', path: '/now-playing' }, { name: 'a song list', path: '/search/telugu' }]) {
  test(`scrolling the song menu never scrolls ${where.name} behind it`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await seed(page, baseURL!);
    await page.goto(where.path);
    await page.getByRole('button', { name: /More options/ }).first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const before = await pageScroll(page);
    const box = (await menu.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 240); // through the list and well past its end
    await page.waitForTimeout(250);
    await expect(menu).toBeVisible(); // it used to scroll its own trigger away and close
    expect(await menu.evaluate((m) => m.scrollTop)).toBeGreaterThan(0); // the menu itself still scrolls
    await page.mouse.move(12, 700); // the dimmed backdrop
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
    expect(await pageScroll(page)).toEqual(before);
    await expect(menu).toBeVisible();
  });
}

test('top bar: no search box, Home actions live in it; Discover offers Ads on a phone', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await seed(page, baseURL!);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  const bar = page.locator('.vx-topbar');
  await expect(bar.getByRole('button', { name: 'Notifications' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  await expect(bar.getByRole('link', { name: /settings/i })).toBeVisible();
  expect(await bar.getByRole('link', { name: /search/i }).count()).toBe(0);
  await page.screenshot({ path: 'test-results/v701-home-412.png' });
  await page.goto('/search');
  await expect(page.getByRole('combobox', { name: 'Search music' })).toHaveCount(1); // the page's own field is the only search box
  await page.screenshot({ path: 'test-results/v701-search-412.png' });
  await page.goto('/discover');
  await expect(page.getByRole('navigation', { name: 'Browse music' }).getByRole('link', { name: 'Ads' })).toBeVisible();
  await page.screenshot({ path: 'test-results/v701-discover-412.png' });
});
