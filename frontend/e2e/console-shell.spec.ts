import { test, expect, type Page } from './support/test';

/**
 * 13.8 — owner console shell (/admin/, static files, not the React app):
 * sign-in against a mocked server, the sidebar and hash router, Ctrl+K quick
 * jump and the mobile menu. 14.0 — the console lands on Overview again (the
 * database is back). Every page's own behaviour is covered by
 * console-pages. All non-localhost network is aborted; zero page or console
 * errors allowed.
 */

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

type Mode = 'full' | 'empty';

async function mockApi(page: Page, mode: Mode, password = 'owner-pass'): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const token = route.request().headers()['x-admin-token'];
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/version') return send({ version: '13.8.0' });
    if (url.pathname.startsWith('/api/admin/') && token !== password) return send({ error: 'unauthorized' }, 401);
    switch (url.pathname) {
      case '/api/admin/envcheck':
        return send({ items: [], missingRequired: mode === 'full' ? ['CRON_SECRET'] : [], checkedAt: iso(0) });
      case '/api/admin/health':
        return send({ time: iso(0), ai: [], lanes: [] });
      case '/api/admin/overview':
        return send(mode === 'full'
          ? { configured: true, schema: { version: 1, appliedAt: iso(48) }, kpis: { activeNow: 3, listeners: 120, newListeners24h: 4, accounts: 30, plays24h: 400, plays7d: 2600, errors24h: 1, dau: 40, wau: 90, mau: 110, feedbackNew: 2, pushDevices: 55, roomsActive: 1, aiCalls24h: 12 }, timeline: [{ day: '2026-10-23', plays: 300, listeners: 30, newListeners: 2, errors: 0, searches: 40 }, { day: '2026-10-24', plays: 400, listeners: 40, newListeners: 4, errors: 1, searches: 50 }], platforms: [{ platform: 'android', listeners: 80, accounts: 20 }, { platform: 'web', listeners: 40, accounts: 10 }], attention: [{ level: 'warn', text: '2 new feedback messages', page: 'feedback' }] }
          : { configured: true, kpis: {}, timeline: [], platforms: [], attention: [] });
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
    await expect(page.locator('#pageBody')).toContainText('Listening now');

    // Sign out clears the session.
    await page.click('#logoutBtn');
    await expect(page.locator('#login')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('vinax_admin_token'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('every sidebar page opens, and Ctrl+K jumps to a tab', async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, 'empty');
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/overview');
    const links = page.locator('#nav .nav-link');
    const count = await links.count();
    expect(count).toBe(12);
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
    // Health → Releases answers slowly; the owner switches tabs first.
    await page.route('**/api/admin/releases**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, release: { tag: 'v1', name: 'Late release', notes: '', assets: [] }, runs: [], commits: [], live: null }) });
    });
    await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
    await page.goto('/admin/#/health/releases');
    await page.getByRole('tab', { name: 'Server secrets' }).click();
    await expect(page.getByRole('tab', { name: 'Server secrets' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(2500); // past the slow Releases answer
    // Before 13.8.1 the late answer replaced the open tab with the old one.
    await expect(page.locator('#pageBody')).not.toContainText('Late release');
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
    await page.locator('#nav .nav-link', { hasText: 'Catalog' }).click();
    await expect(page.locator('#pageTitle')).toHaveText('Catalog');
    await expect(page.locator('#sidebar')).not.toBeInViewport();
  });
});
