import { test, expect, type Page } from './support/test';
import { mockConsole, signedIn, watchErrors } from './support/consoleMocks';

/**
 * Console rebuild — every page and tab of the owner console against the
 * shared mocks (e2e/support/console-mocks), with full data, with empty
 * answers and with a failing server. Checks the done-list of the rebuild:
 * no page errors, every stat card explains itself (ⓘ), the spec's plain
 * words only (no Publish, App default, Device only, d_ ids, undefined, NaN),
 * a phone width without sideways scrolling, and viewers cannot change
 * anything. All non-localhost network is aborted.
 */

interface Route { hash: string; where: string }

async function routes(page: Page): Promise<Route[]> {
  return page.evaluate(() => {
    const vx = (window as unknown as { VX: { pages: () => Array<{ id: string; tabs?: Array<{ id: string }> }> } }).VX;
    const out: Array<{ hash: string; where: string }> = [];
    for (const p of vx.pages()) {
      if (p.tabs && p.tabs.length > 1) for (const t of p.tabs) out.push({ hash: `#/${p.id}/${t.id}`, where: `${p.id}/${t.id}` });
      else out.push({ hash: `#/${p.id}`, where: p.id });
    }
    return out;
  });
}

const BANNED = /\b(Publish|App default|Device only|devices sharing usage|undefined|NaN)\b|\[object Object\]|\bd_[a-f0-9]{8,}/;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.locator('#pageBody .state.loading, #pageBody .skeleton')).toHaveCount(0, { timeout: 8000 }).catch(() => undefined);
}

test.describe('console pages', () => {
  test('every page and tab works with data: no errors, ⓘ on every stat card, plain words', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await expect(page.locator('#app')).toBeVisible();
    const list = await routes(page);
    expect(list.length).toBeGreaterThanOrEqual(40);
    for (const r of list) {
      await page.goto('/admin/' + r.hash);
      await settle(page);
      await expect(page.getByText('Page not found'), r.where).toHaveCount(0);
      const text = (await page.locator('#main').innerText()) ?? '';
      expect(text.match(BANNED)?.[0] ?? null, `${r.where} shows banned text`).toBeNull();
      const stats = page.locator('#pageBody .stat-wrap');
      const n = await stats.count();
      for (let i = 0; i < n; i++) await expect(stats.nth(i).locator('.info-btn'), `${r.where} stat card ${i + 1} has an ⓘ`).toHaveCount(1);
      await expect(page.locator('#pageBody .state.error'), `${r.where} failed to load`).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('every page and tab survives empty answers and a failing server', async ({ page }) => {
    test.setTimeout(240_000);
    for (const mode of ['empty', 'fail'] as const) {
      const p = await page.context().newPage();
      const errors = watchErrors(p);
      const { sent } = await mockConsole(p, { mode });
      await signedIn(p);
      await p.goto('/admin/#/dashboard');
      await expect(p.locator('#app')).toBeVisible();
      for (const r of await routes(p)) {
        const before = sent.length;
        await p.goto('/admin/' + r.hash);
        await settle(p);
        const loaded = sent.slice(before).some((s) => s.method === 'GET' && s.path.startsWith('/api/admin/') && !s.path.startsWith('/api/admin/session'));
        const text = (await p.locator('#main').innerText()) ?? '';
        expect(text.match(BANNED)?.[0] ?? null, `${mode}: ${r.where}`).toBeNull();
        if (mode === 'fail' && loaded) {
          // A failure says so with a way to try again; it never shows zeros as if real.
          const shown = await p.locator('#pageBody .state.error, #pageBody .notice.bad').count();
          expect(shown, `${mode}: ${r.where} shows an error state`).toBeGreaterThan(0);
        }
      }
      expect(errors, mode).toEqual([]);
      await p.close();
    }
  });

  test('pages fit a phone: no sideways scrolling', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    for (const r of await routes(page)) {
      await page.goto('/admin/' + r.hash);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${r.where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test('a viewer can look but not change settings', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page, { role: 'viewer' });
    await signedIn(page);
    await page.goto('/admin/#/app-settings/maintenance');
    await settle(page);
    await expect(page.getByText('view-only access').first()).toBeVisible();
    const saves = page.getByRole('button', { name: 'Save & apply' });
    expect(await saves.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await saves.count()); i++) await expect(saves.nth(i)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('saving a setting asks first and posts the setting', async ({ page }) => {
    const errors = watchErrors(page);
    const { sent } = await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/app-settings/notification-rules');
    await settle(page);
    const card = page.locator('#setting-push');
    await expect(card.locator('.status-chip')).toHaveText("Using app's built-in setting");
    await card.locator('select').first().selectOption({ index: 1 });
    await expect(card.locator('.status-chip')).toHaveText('Unsaved changes');
    await card.getByRole('button', { name: 'Save & apply' }).click();
    await expect(page.getByText('Users will see this change within 1 minute. Continue?')).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Save & apply' }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    const post = sent.find((s) => s.method === 'POST' && s.path === '/api/admin/settings');
    expect(post?.body).toMatchObject({ key: 'push' });
    await expect(card.locator('.status-chip')).toHaveText('Live in app');
    expect(errors).toEqual([]);
  });

  test('Users lists signed-in people only and opens a profile', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/users');
    await settle(page);
    await expect(page.getByText('Users · signed in with Google')).toBeVisible();
    await expect(page.locator('#pageBody th').filter({ hasText: /^Account$/ })).toHaveCount(0);
    await expect(page.locator('#pageBody th').filter({ hasText: /^Devices$/ })).toHaveCount(1);
    await page.locator('#pageBody tbody tr').first().click();
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#drawer').getByRole('tab', { name: 'Devices' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
