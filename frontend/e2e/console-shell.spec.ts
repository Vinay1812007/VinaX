import { test, expect } from './support/test';
import { mockConsole, signedIn, watchErrors } from './support/consoleMocks';

/**
 * Console rebuild — the shell (/admin/, static files, not the React
 * app): sign-in, the sidebar (ten folding groups, one job per page, and
 * "Find a page"), the
 * router (old addresses redirect, unknown ones say "Page not found"), the top
 * bar (search, date range, theme, profile) and the phone menu. Each page's
 * own behaviour is in console-pages.spec.ts. All non-localhost network is
 * aborted; zero page or console errors allowed.
 */

test.describe('console shell', () => {
  test('the recovery password signs in; a wrong one is refused', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await page.goto('/admin/');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#gsiBtn')).toContainText('Google sign-in is not set up');
    // Without Google sign-in set up, the recovery password box opens by itself.
    await expect(page.locator('#pwBox')).toHaveAttribute('open', '');
    await page.fill('#token', 'wrong');
    await page.click('#enter');
    await expect(page.locator('#loginErr')).toContainText('not right');
    expect(await page.evaluate(() => sessionStorage.getItem('vinax_admin_token'))).toBeNull();

    await page.fill('#token', 'owner-pass');
    await page.click('#enter');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.locator('#pageTitle')).toHaveText('Dashboard');

    await page.click('#profileBtn');
    await expect(page.locator('#profilePop')).toContainText('Owner');
    await page.locator('#profilePop').getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#loginErr')).toContainText('Signed out');
    expect(errors).toEqual([]);
  });

  test('the sidebar has ten folding groups; only the current one starts open', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/');
    await expect(page).toHaveURL(/#\/dashboard$/);
    const groups = page.locator('.nav-group-toggle');
    await expect(groups).toHaveText(['Overview', 'Users', 'Music Stats', 'Audience', 'Search & Library', 'Notifications', 'App Settings', 'App Health', 'Growth & SEO', 'System']);
    // On the Dashboard only Overview is open.
    await expect(page.locator('.nav-group.open')).toHaveCount(1);
    await expect(page.locator('.nav-group.open .nav-link')).toHaveText(['Dashboard', 'Listening Now', 'Recent Activity', 'Listen Together Rooms', 'Smart Alerts']);
    await groups.filter({ hasText: 'App Health' }).click();
    await expect(page.locator('.nav-group[data-group="App Health"] .nav-link')).toHaveText(['App Errors', 'Server Checks', 'Music Sources', 'AI Assistant', 'Recommendations', 'App Versions', 'API Keys Status']);
    await groups.filter({ hasText: 'App Health' }).click();
    await expect(page.locator('.nav-group[data-group="App Health"] ul')).toBeHidden();
    await groups.filter({ hasText: 'Users' }).click();
    await page.getByRole('link', { name: 'All Users' }).click();
    await expect(page).toHaveURL(/#\/users/);
    await expect(page.locator('#crumbs')).toContainText('Users');
    await expect(page.locator('#pageTitle')).toHaveText('All Users');
    await expect(page.locator('#pageDesc')).toContainText('Everyone who signed in');
    // Moving to another group starts fresh: only Users is open now.
    await expect(page.locator('.nav-group.open')).toHaveCount(1);
    await expect(page.locator('.nav-group.open')).toHaveAttribute('data-group', 'Users');
    await expect(page.locator('#envChip')).toHaveText('Test site');
    expect(errors).toEqual([]);
  });

  test('Find a page filters the menu and opens the first match', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await page.fill('#navFilter', 'keys');
    await expect(page.locator('#nav .nav-link')).toHaveText(['API Keys Status']);
    await page.press('#navFilter', 'Enter');
    await expect(page).toHaveURL(/#\/api-keys$/);
    await expect(page.locator('#navFilter')).toHaveValue('');
    await page.fill('#navFilter', 'zzzz');
    await expect(page.locator('.nav-empty')).toContainText('No page matches');
    await page.press('#navFilter', 'Escape');
    await expect(page.locator('.nav-group-toggle')).toHaveCount(10);
    expect(errors).toEqual([]);
  });

  test('old addresses redirect and unknown ones say Page not found', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    const cases: Array<[string, RegExp]> = [
      ['#/overview', /#\/dashboard$/],
      ['#/listeners', /#\/users$/],
      ['#/publish', /#\/app-settings\/home-screen$/],
      ['#/notify', /#\/send-notification$/],
      ['#/notify/push', /#\/notification-setup$/],
      ['#/analytics/errors', /#\/app-errors$/],
      ['#/analytics', /#\/top-songs$/],
      ['#/catalog', /#\/find-music$/],
      ['#/experiments', /#\/ab-tests$/],
      ['#/seo', /#\/google-search$/],
      // Every tab of the pages split up in the one-job-per-page rebuild.
      ['#/health/errors?range=1', /#\/app-errors\?range=1$/],
      ['#/health/checks', /#\/server-checks$/],
      ['#/health', /#\/app-errors$/],
      ['#/live/rooms', /#\/listen-together$/],
      ['#/song-stats/places', /#\/where-users-are$/],
      ['#/library/blocked', /#\/blocked-music$/],
      ['#/search-insights/nothing-found', /#\/search-no-results$/],
      ['#/notifications/history', /#\/sent-notifications$/],
      ['#/database/changes', /#\/change-log$/],
      ['#/google-search/pages', /#\/page-check$/],
      ['#/google-search', /#\/google-search$/],
      ['#/app-settings/notification-rules', /#\/notification-rules$/],
      ['#/users?user=1001', /#\/user\?id=1001$/],
    ];
    for (const [from, to] of cases) {
      await page.goto('/admin/' + from);
      await expect(page, from).toHaveURL(to);
    }
    await page.goto('/admin/#/send-notification');
    await expect(page.locator('#pageTitle')).toHaveText('Send Notification');
    await page.goto('/admin/#/no-such-page');
    await expect(page.getByText('Page not found').first()).toBeVisible();
    await page.getByRole('button', { name: 'Go to Dashboard' }).click();
    await expect(page).toHaveURL(/#\/dashboard$/);
    expect(errors).toEqual([]);
  });

  test('Ctrl+K searches pages and settings', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette input')).toBeFocused();
    await page.keyboard.type('notification rules');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/notification-rules/);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette input')).toBeFocused();
    await page.keyboard.type('google search');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/google-search/);
    expect(errors).toEqual([]);
  });

  test('date range, theme and auto-refresh controls work', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    const range = page.locator('#rangeHost select');
    await expect(range).toBeVisible();
    await range.selectOption('30');
    await expect(page).toHaveURL(/range=30/);
    await page.locator('#themeSel').selectOption('light');
    await expect(page.locator('html')).toHaveClass(/light/);
    await page.locator('#themeSel').selectOption('dark');
    await expect(page.locator('html')).not.toHaveClass(/light/);
    await page.locator('#autoRefresh').check({ force: true });
    await expect(page.locator('#autoMs')).toBeEnabled();
    await expect(page.locator('#updated')).toContainText('Last updated');
    await page.goto('/admin/#/users');
    await expect(page.locator('#rangeHost')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('on a phone the menu opens and closes', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    await page.click('#menuBtn');
    await expect(page.locator('#sidebar')).toBeInViewport();
    await page.locator('.nav-group-toggle').filter({ hasText: 'Users' }).click();
    await page.getByRole('link', { name: 'Feedback' }).click();
    await expect(page).toHaveURL(/#\/feedback/);
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('on a phone: a bottom bar, two stat cards a row, tables as cards, no sideways scroll', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/users');
    const bar = page.locator('#bottomBar');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    // Each person is a card: no header row, the name spans the card.
    const row = page.locator('#pageBody .dt tbody tr').first();
    await expect(row).toBeVisible();
    await expect(page.locator('#pageBody .dt thead').first()).toBeHidden();
    const [cardBox, nameBox] = await Promise.all([row.boundingBox(), row.locator('td.cell-primary').boundingBox()]);
    expect(nameBox!.width).toBeGreaterThan(cardBox!.width * 0.7);
    // Stat cards: two to a row.
    const stats = page.locator('#pageBody .kpis.stats').first().locator('.stat-wrap');
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => stats.nth(i).boundingBox()));
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(c!.y).toBeGreaterThan(a!.y + 10);
    for (const path of ['users', 'feedback', 'dashboard', 'notification-rules']) {
      await page.goto(`/admin/#/${path}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
    // A page outside the bar lights up Menu; Menu opens the drawer.
    await expect(bar.getByRole('button', { name: 'Menu' })).toHaveClass(/\bon\b/);
    await bar.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#sidebar')).toBeInViewport();
    await page.locator('#scrimNav').click({ position: { x: 360, y: 400 } });
    await bar.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/#\/dashboard/);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(bar).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('an owner sees the database update banner while the database is behind', async ({ page }) => {
    await mockConsole(page, { schema: 7 });
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await expect(page.locator('#dbBanner')).toContainText('database update');
  });
});
