/**
 * 13.9 — browse first, sign in to listen. Signed out (?e2e-signed-out), the
 * browse pages open in the live app with a Sign in button where the avatar
 * goes; the first play, like or save opens the sign-in sheet instead of
 * acting; the sign-in page and the published pages link into Explore.
 */
import { expect, test, type Page } from './support/test';

const blockGoogle = (page: Page) => page.route('**/accounts.google.com/**', (r) => r.abort());

/**
 * A visitor who chose to explore: signed out on every load (the suite's
 * context signs the test account in unless the address says e2e-signed-out,
 * and a plain link drops the query), with the tab's "browse first" choice
 * made — without it a direct load of a published URL such as /explore shows
 * the published text, as 13.5.0 intends.
 */
async function browseAsGuest(page: Page): Promise<void> {
  await blockGoogle(page);
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('vinax.account.v1');
      sessionStorage.setItem('vinax.guest-browse', '1');
    } catch {
      /* storage blocked */
    }
  });
}

test('signed out, Explore, Search and a song page are the live app with a Sign in button', async ({ page }) => {
  await browseAsGuest(page);
  for (const path of ['/explore', '/search', '/song/x-123', '/discover']) {
    await page.goto(path);
    await expect(page.locator('.vx-topbar')).toBeVisible();
    await expect(page.locator('.vx-topbar .vx-topbar-signin')).toHaveText('Sign in');
    await expect(page.locator('.vx-avatar')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
  }
});

test('tapping play on Explore asks to sign in and plays nothing; the sheet closes', async ({ page }) => {
  await browseAsGuest(page);
  const api: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/')) api.push(p);
  });
  await page.goto('/explore');
  await page.getByRole('button', { name: /^Play \d{4}$/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign in to start listening' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Songs play once you are signed in', { exact: false })).toBeVisible();
  // Nothing was searched or started: the gate runs before the catalogue is asked.
  expect(api.filter((p) => p.startsWith('/api/search') || p.startsWith('/api/song'))).toEqual([]);
  await expect(page.locator('.vx-deck')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('the top bar Sign in button opens the sheet; the sign-in page links to Explore', async ({ page }) => {
  await browseAsGuest(page);
  await page.goto('/explore');
  await page.locator('.vx-topbar-signin').click();
  await expect(page.getByRole('dialog', { name: 'Sign in to VinaX' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sign in to VinaX' })).toHaveCount(0);
  // Home stays the sign-in screen for a visitor; its card links into Explore.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore VinaX first' }).click();
  await expect(page).toHaveURL(/\/explore/);
  await expect(page.locator('.vx-topbar-signin')).toBeVisible();
});

test('a published page offers Explore, and the choice holds for the tab', async ({ page }) => {
  await blockGoogle(page);
  // Signed out on every load, the choice NOT yet made: the published text first.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('vinax.account.v1');
    } catch {
      /* storage blocked */
    }
  });
  await page.goto('/charts/');
  await expect(page.getByRole('heading', { name: 'Listen free on VinaX' })).toBeVisible();
  await page.locator('header.vx-public-bar').getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore/);
  await expect(page.locator('.vx-topbar-signin')).toBeVisible();
  // Back on a published URL in the same tab: the live page now, not the published text.
  await page.goto('/charts/');
  await expect(page.locator('.vx-topbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listen free on VinaX' })).toHaveCount(0);
});

test('signed in, nothing changes: the avatar, no Sign in button, play goes straight through', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.locator('.vx-avatar')).toHaveAttribute('aria-label', /Tester/);
  await expect(page.locator('.vx-topbar-signin')).toHaveCount(0);
});
