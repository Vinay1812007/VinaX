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
    await page.goto('/admin/#/notification-rules');
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

  test('the weekly summary email: switch, recipients, last send and a test', async ({ page }) => {
    const errors = watchErrors(page);
    const { sent } = await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/notification-rules');
    await settle(page);
    const card = page.locator('#setting-email');
    await expect(card.getByText('Weekly summary to you')).toBeVisible();
    await expect(card.getByText(/Last sent .* to owner@example\.com\./)).toBeVisible();
    await expect(card.getByText(/Goes to owner@example\.com \(every Owner\)/)).toBeVisible();
    const to = card.getByLabel('Who gets the weekly summary');
    await to.fill('Me@Example.com, not-an-email, me@example.com, two@example.in');
    await to.blur();
    await expect(to).toHaveValue('me@example.com, two@example.in');
    await expect(card.locator('.status-chip')).toHaveText('Unsaved changes');
    await card.getByRole('button', { name: 'Send a test now' }).click();
    await expect(page.getByText('Test weekly summary sent to owner@example.com ✓')).toBeVisible();
    expect(sent.find((s) => s.method === 'POST' && s.path === '/api/admin/email')?.body).toMatchObject({ action: 'weekly-test' });
    await card.getByRole('button', { name: 'Save & apply' }).click();
    await page.locator('.modal').getByRole('button', { name: 'Save & apply' }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    const post = sent.find((s) => s.method === 'POST' && s.path === '/api/admin/settings');
    expect(post?.body).toMatchObject({ key: 'email', value: { weeklySummary: true, weeklyTo: ['me@example.com', 'two@example.in'] } });
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
    // Schema 13: people by device (the Android app first) and listening time.
    const cards = page.locator('#pageBody .users-stats .kpi-label');
    await expect(cards.filter({ hasText: /^Listening today$/ })).toHaveCount(1);
    await expect(cards.filter({ hasText: /^Android app$/ })).toHaveCount(1);
    await expect(cards.filter({ hasText: /^Mac web$/ })).toHaveCount(1);
    await expect(cards.filter({ hasText: /^(Android|Web|iOS)$/ })).toHaveCount(0);
    await expect(page.locator('#pageBody th').filter({ hasText: /^Listening \(30 d\)$/ })).toHaveCount(1);
    await expect(page.locator('#pageBody tbody').getByText('Mac web · Chrome')).toBeVisible();
    await page.locator('#pageBody .users-stats button.kpi').filter({ hasText: 'Mac web' }).click();
    await expect(page).toHaveURL(/platform=macos-web/);
    await expect(page.locator('#pageBody tbody tr')).toHaveCount(1);
    await page.goto('/admin/#/users');
    await settle(page);
    // Schema 15: tags show as chips and filter the list.
    await expect(page.locator('#pageBody tbody .tag-chips').first()).toBeVisible();
    await page.locator('#pageBody select[aria-label="Tag"]').selectOption('tester');
    await expect(page).toHaveURL(/tag=tester/);
    await expect(page.locator('#pageBody tbody tr')).toHaveCount(2);
    await page.goto('/admin/#/users');
    await settle(page);
    await page.locator('#pageBody tbody tr').first().click();
    // The profile is its own page, with a way back to the list.
    await expect(page).toHaveURL(/#\/user\?id=\d+$/);
    await expect(page.locator('#pageTitle')).toHaveText('User Profile');
    const body = page.locator('#pageBody');
    await expect(body.getByRole('tab', { name: 'Devices' })).toBeVisible();
    await expect(body.locator('.kpi-label').filter({ hasText: /^Listening time$/ })).toHaveCount(1);
    await expect(body.getByText('Time spent each day')).toBeVisible();
    // Schema 15: notes and tags, when they listen, skips and replays, searches.
    await expect(body.locator('.profile-notes')).toContainText('Early tester from the Telugu group.');
    await expect(body.getByText('When they listen')).toBeVisible();
    await expect(body.getByText(/Most often 9 pm–10 pm/)).toBeVisible();
    await body.locator('.profile-notes').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('New tag').fill('Family');
    await page.getByLabel('New tag').press('Enter');
    await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
    await expect(body.locator('.profile-notes .tag-chips')).toContainText('family');
    await body.getByRole('tab', { name: 'Skips & replays' }).click();
    await expect(body.getByText('Skipped most')).toBeVisible();
    await expect(body.getByText('Comes back to')).toBeVisible();
    await body.getByRole('tab', { name: /Searches/ }).click();
    await expect(body.getByText('old telugu devotional 1980')).toBeVisible();
    await expect(body.getByText('No results').first()).toBeVisible();
    await body.getByRole('tab', { name: 'Overview' }).click();
    // Schema 12: the sign-in history, with the IP address and a chip for a new device.
    await body.getByRole('tab', { name: /Sign-ins/ }).click();
    await expect(body.getByText('203.0.113.7')).toBeVisible();
    await expect(body.getByText('Chrome on Windows')).toBeVisible();
    await expect(body.getByText('New device')).toBeVisible();
    await expect(body.getByText('First sign-in')).toBeVisible();
    await body.getByRole('button', { name: 'Back to All Users' }).click();
    await expect(page).toHaveURL(/#\/users$/);
    expect(errors).toEqual([]);
  });

  test('Top Listeners, At Risk, When They Listen and Do They Come Back show their data', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    const body = page.locator('#pageBody');
    // Schema 14: ranked by listening time, with a Today / 7 days / 30 days switch.
    await page.goto('/admin/#/top-listeners');
    await settle(page);
    await expect(body.locator('tbody tr').first()).toContainText('Asha Rao');
    await body.getByRole('radio', { name: '30 days' }).click();
    await expect(page).toHaveURL(/days=30/);
    await expect(body.getByText('Top listeners in the last 30 days')).toBeVisible();
    await body.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/#\/user\?id=\d+$/);
    await page.goto('/admin/#/at-risk');
    await settle(page);
    await expect(body.getByText('Regular listeners who went quiet')).toBeVisible();
    await expect(body.locator('tbody tr')).toHaveCount(5);
    await page.goto('/admin/#/listening-hours');
    await settle(page);
    await expect(body.locator('.heat-cell').first()).toBeVisible();
    await expect(body.getByText('Friday 21:00')).toBeVisible();
    // A list answer reaches the page (it used to be turned into {} and the page looked empty).
    await page.goto('/admin/#/coming-back');
    await settle(page);
    await expect(body.locator('table.cohort-grid tbody tr')).toHaveCount(8);
    await expect(body.getByText('Not yet').first()).toBeVisible();
    await page.goto('/admin/#/signup-journey');
    await settle(page);
    await expect(body.locator('.funnel-step')).toHaveCount(4);
    await page.goto('/admin/#/skipped-songs');
    await settle(page);
    await expect(body.locator('tbody tr').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Phones & Browsers and time in the app (schema 16)', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/phones-browsers');
    await settle(page);
    await expect(page.locator('#pageTitle')).toHaveText('Phones & Browsers');
    const body = page.locator('#pageBody');
    await expect(body.locator('.kpi-label').filter({ hasText: /^On the home screen$/ })).toHaveCount(1);
    await expect(body.getByText('Web app on the home screen')).toBeVisible();
    await expect(body.getByText('SM-A536E')).toBeVisible();
    await expect(body.getByText('Android 14', { exact: true })).toBeVisible();
    // All Users: a time-in-app column beside listening.
    await page.goto('/admin/#/users');
    await settle(page);
    // Hidden until chosen from the Columns picker (the table is wide already).
    await expect(body.locator('th').filter({ hasText: /^Time in app \(30 d\)$/ })).toHaveCount(0);
    await body.getByRole('button', { name: 'Show or hide columns' }).click();
    await page.getByRole('menuitem', { name: /Time in app \(30 d\)/ }).click();
    await expect(body.locator('th').filter({ hasText: /^Time in app \(30 d\)$/ })).toHaveCount(1);
    await expect(body.locator('tbody').getByText('25 h 33 min')).toBeVisible();
    // A profile: the card, and the phone model on the Devices tab.
    await page.locator('#pageBody tbody tr').first().click();
    await expect(page).toHaveURL(/#\/user\?id=\d+$/);
    await expect(body.locator('.kpi-label').filter({ hasText: /^Time in app$/ })).toHaveCount(1);
    await body.getByRole('tab', { name: /Devices/ }).click();
    await expect(body.getByText('Samsung SM-S918B · Android 14')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
