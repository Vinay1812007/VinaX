import { test, expect } from './support/test';
import { mockConsole, signedIn, watchErrors } from './support/consoleMocks';

/**
 * Console rebuild — the shell (/admin/, static files, not the React
 * app): sign-in, the grouped sidebar with the App Settings sub-menu, the
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

  test('the sidebar has the six groups and the App Settings sub-menu', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/');
    const labels = await page.locator('.nav-group-label').allTextContents();
    expect(labels).toEqual(['Home', 'People', 'Music', 'Engage', 'App Settings', 'System']);
    const sub = page.locator('.nav-group.sub');
    await expect(sub.locator('.nav-link')).toHaveText(['Home Screen', 'Features & AI', 'App Updates', 'Maintenance', 'Notification Rules', 'Search & Music Sources', 'Help Center', 'Data & Privacy']);
    await sub.locator('.nav-group-toggle').click();
    await expect(page.locator('.nav-group.sub ul')).toBeHidden();
    await page.locator('.nav-group.sub .nav-group-toggle').click();
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/#\/users/);
    await expect(page.locator('#crumbs')).toContainText('People');
    await expect(page.locator('#envChip')).toHaveText('Test site');
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
      ['#/notify', /#\/notifications$/],
      ['#/notify/push', /#\/notifications\/setup$/],
      ['#/analytics/errors', /#\/health\/errors$/],
      ['#/analytics', /#\/song-stats$/],
      ['#/catalog', /#\/library(\/search)?$/],
      ['#/experiments', /#\/ab-tests$/],
      ['#/seo', /#\/google-search$/],
    ];
    for (const [from, to] of cases) {
      await page.goto('/admin/' + from);
      await expect(page, from).toHaveURL(to);
    }
    await page.goto('/admin/#/notifications');
    await expect(page.locator('#pageTitle')).not.toHaveText('Dashboard');
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
    await expect(page).toHaveURL(/#\/app-settings\/notification-rules/);
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
    await page.getByRole('link', { name: 'Feedback' }).click();
    await expect(page).toHaveURL(/#\/feedback/);
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('an owner sees the database update banner while the database is behind', async ({ page }) => {
    await mockConsole(page, { schema: 7 });
    await signedIn(page);
    await page.goto('/admin/#/dashboard');
    await expect(page.locator('#dbBanner')).toContainText('database update');
  });
});
