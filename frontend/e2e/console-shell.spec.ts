import { test, expect, type Page } from './support/test';

/**
 * 13.8 — owner console shell (/admin/, static files, not the React app):
 * sign-in against a mocked server, the sidebar and hash router, Ctrl+K quick
 * jump, the mobile menu, and the Overview page with live data, a fresh empty
 * database and a database outage. Every page's own behaviour is covered by
 * console-audience / console-content / console-intelligence / console-system.
 * All non-localhost network is aborted; zero page or console errors allowed.
 */

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const OVERVIEW = {
  configured: true,
  summary: { active_now: 7, total_users: 1200, new_today: 14, plays_today: 340, plays_7d: 2100, errors_24h: 3, dau: 120, wau: 400, mau: 900, feedback_new: 2 },
  newUsersByDay: [0, 1, 2, 3].map((i) => ({ day: day(i), users: 10 + i })),
  playsByDay: [0, 1, 2, 3, 4].map((i) => ({ day: day(i), plays: 200 + i * 13 })),
  topSongs: [{ song_title: 'Kesariya', song_artist: 'Arijit Singh', song_image: null, plays: 88 }],
  topCountries: [{ country: 'IN', listeners: 300 }, { country: 'US', listeners: 40 }],
  accounts: { total: 58, newToday: 3, active7d: 30 },
};
const EMPTY_OVERVIEW = {
  configured: true,
  summary: { active_now: 0, total_users: 0, new_today: 0, plays_today: 0, plays_7d: 0, errors_24h: 0, dau: 0, wau: 0, mau: 0, feedback_new: 0 },
  newUsersByDay: [], playsByDay: [], topSongs: [], topCountries: [],
  accounts: { total: 0, newToday: 0, active7d: 0 },
};
const REALTIME = { configured: true, startsPerMin: 3, joins5m: 1, errors5m: 0, recentErrors: [], liveListeners: 7, liveCities: [], aiP50: 840, aiOkRate: 98, aiCalls15m: 12, activeRooms: 1 };

type Mode = 'full' | 'empty' | 'down';

async function mockApi(page: Page, mode: Mode, password = 'owner-pass'): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const token = route.request().headers()['x-admin-token'];
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/version') return send({ version: '13.8.0' });
    if (url.pathname.startsWith('/api/admin/') && token !== password) return send({ error: 'unauthorized' }, 401);
    if (mode === 'down' && url.pathname === '/api/admin/overview') return send({ error: 'db_unavailable' }, 502);
    switch (url.pathname) {
      case '/api/admin/envcheck':
        return send({ items: [], missingRequired: mode === 'full' ? ['CRON_SECRET'] : [], checkedAt: iso(0) });
      case '/api/admin/realtime':
        return send(mode === 'full' ? REALTIME : { ...REALTIME, liveListeners: 0, startsPerMin: 0, aiCalls15m: 0, activeRooms: 0 });
      case '/api/admin/overview':
        return send(mode === 'full' ? OVERVIEW : EMPTY_OVERVIEW);
      default:
        // Other pages are covered by their own specs; answer "empty".
        return send({ configured: true });
    }
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.describe('owner console shell', () => {
  test('sign-in rejects a wrong password and accepts the right one', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    await page.goto('/admin/');
    await expect(page.locator('#login')).toBeVisible();
    await page.fill('#token', 'wrong');
    await page.click('#enter');
    await expect(page.locator('#loginErr')).toContainText('not right');
    expect(await page.evaluate(() => sessionStorage.getItem('vinax_admin_token'))).toBeNull();

    await page.fill('#token', 'owner-pass');
    await page.click('#enter');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#pageTitle')).toHaveText('Overview');
    await expect(page).toHaveURL(/#\/overview$/);

    // Sign out clears the session.
    await page.click('#logoutBtn');
    await expect(page.locator('#login')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('vinax_admin_token'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('Overview shows live data, attention items and charts', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'full');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const body = page.locator('#pageBody');
    await expect(body).toContainText('Right now');
    await expect(body).toContainText('Signed-in accounts');
    await expect(body.locator('.kpi', { hasText: 'Signed-in accounts' })).toContainText('58');
    await expect(body).toContainText('Needs attention');
    await expect(body).toContainText('CRON_SECRET');
    await expect(body).toContainText('Kesariya');
    await expect(body).toContainText('India');
    await expect(body.locator('.chart-svg').first()).toBeVisible();
    const text = await body.innerText();
    expect(text).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);

    // "Open" on an attention row deep-links into the right page and tab.
    await body.locator('.card', { hasText: 'Needs attention' }).getByRole('button', { name: 'Open' }).first().click();
    await expect(page).toHaveURL(/#\/health\/env/);
    expect(errors).toEqual([]);
  });

  test('Overview on a fresh, empty database explains what will appear', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const body = page.locator('#pageBody');
    await expect(body).toContainText('The database is new and empty');
    await expect(body).toContainText('No plays yet');
    await expect(body).not.toContainText('Needs attention');
    expect(await body.innerText()).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);
    expect(errors).toEqual([]);
  });

  test('a database outage shows an error with retry, not a blank page', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'down');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const body = page.locator('#pageBody');
    await expect(body.locator('.state.error')).toContainText('not reachable');
    await expect(body.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('every sidebar page opens, and Ctrl+K jumps to a tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const links = page.locator('#nav .nav-link');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(14);
    for (let i = 0; i < count; i += 1) {
      const link = links.nth(i);
      const name = (await link.innerText()).trim();
      await link.click();
      await expect(page.locator('#pageTitle')).toHaveText(name);
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#pageBody')).not.toBeEmpty();
    }

    await page.keyboard.press('Control+k');
    const jump = page.getByRole('combobox', { name: 'Jump to' });
    await expect(jump).toBeFocused();
    await jump.fill('server secrets');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/health\/env/);
    expect(errors).toEqual([]);
  });

  test('a slow tab the owner already left never draws over the tab that is showing', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    // Settings → Feature switches answers slowly; the owner switches tabs first.
    await page.route('**/api/admin/appconfig**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, value: null, updated_at: null }) });
    });
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/settings/flags');
    await page.getByRole('tab', { name: 'Runbook' }).click();
    await expect(page.getByRole('tab', { name: 'Runbook' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(2500); // past the slow Feature switches answer
    // Before 13.8.1 the late answer replaced the Runbook with the switches.
    await expect(page.locator('#pageBody')).not.toContainText('Listen Together');
    expect(errors).toEqual([]);
  });

  test('on a phone the sidebar is a menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, 'empty');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const menu = page.locator('#menuBtn');
    await expect(menu).toBeVisible();
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    await menu.click();
    await expect(page.locator('#sidebar')).toBeInViewport();
    await page.locator('#nav .nav-link', { hasText: 'Feedback' }).click();
    await expect(page.locator('#pageTitle')).toHaveText('Feedback');
    await expect(page.locator('#sidebar')).not.toBeInViewport();
  });
});
