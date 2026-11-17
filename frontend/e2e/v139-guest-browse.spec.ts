/**
 * 13.9 — browse first, sign in to listen. Signed out (?e2e-signed-out), the
 * browse pages open in the live app with a Sign in button where the avatar
 * goes; the first play, like or save opens the sign-in sheet instead of
 * acting; the sign-in page and the published pages link into Discover
 * (Explore folded into Discover; /explore redirects there).
 */
import { expect, test, type Page } from './support/test';

const blockGoogle = (page: Page) => page.route('**/accounts.google.com/**', (r) => r.abort());

/**
 * A visitor who chose to explore: signed out on every load (the suite's
 * context signs the test account in unless the address says e2e-signed-out,
 * and a plain link drops the query), with the tab's "browse first" choice
 * made — without it a direct load of a published URL such as /discover/ shows
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

test('signed out, Discover, Search and a song page are the live app with a Sign in button', async ({ page }) => {
  await browseAsGuest(page);
  for (const path of ['/explore', '/search', '/song/x-123', '/discover']) {
    // /explore is an old address: it lands on Discover.
    await page.goto(path);
    await expect(page.locator('.vx-topbar')).toBeVisible();
    // 1.15 — on a computer the account tools sit in the window bar.
    await expect(page.locator('.vx-winbar .vx-topbar-signin')).toHaveText('Sign in');
    await expect(page.locator('.vx-avatar')).toHaveCount(0);
    await expect(page.locator('main.vx-auth')).toHaveCount(0);
  }
});

test('tapping play on Discover asks to sign in and plays nothing; the sheet closes', async ({ page }) => {
  await browseAsGuest(page);
  // Discover's own shelves search the catalogue as the page loads, so only
  // the year's search ("<year> <language> songs") must never be asked for.
  const queries: string[] = [];
  page.on('request', (r) => {
    const q = new URL(r.url()).searchParams.get('query');
    if (q) queries.push(q);
  });
  await page.goto('/discover');
  const play = page.getByRole('button', { name: /^Play \d{4}$/ });
  const year = ((await play.textContent()) ?? '').replace(/\D/g, '');
  await play.click();
  const sheet = page.getByRole('dialog', { name: 'Sign in to start listening' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Songs play once you are signed in', { exact: false })).toBeVisible();
  // Nothing was searched or started: the gate runs before the catalogue is asked.
  expect(queries.filter((q) => q.startsWith(`${year} `) && q.endsWith(' songs'))).toEqual([]);
  await expect(page.locator('.vx-deck')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('the top bar Sign in button opens the sheet; the sign-in page links to Discover', async ({ page }) => {
  await browseAsGuest(page);
  await page.goto('/discover');
  await page.locator('.vx-topbar-signin').click();
  await expect(page.getByRole('dialog', { name: 'Sign in to VinaX' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sign in to VinaX' })).toHaveCount(0);
  // 1.11 — Home is the catalogue Home for a visitor, with a slim sign-in card.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hi there' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('main.vx-auth')).toHaveCount(0);
  // A personal page sends you to sign in; that page links into Discover.
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Sign in to VinaX', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Explore VinaX first' }).click();
  await expect(page).toHaveURL(/\/discover/);
  await expect(page.locator('.vx-topbar-signin')).toBeVisible();
});

test('a published page offers Explore (Discover), and the choice holds for the tab', async ({ page }) => {
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
  await expect(page).toHaveURL(/\/discover/);
  await expect(page.locator('.vx-topbar-signin')).toBeVisible();
  // Back on a published URL in the same tab: the live page now, not the published text.
  await page.goto('/charts/');
  await expect(page.locator('.vx-topbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listen free on VinaX' })).toHaveCount(0);
});

test('signed in, nothing changes: the avatar, no Sign in button, play goes straight through', async ({ page }) => {
  await page.goto('/discover');
  await expect(page.locator('.vx-avatar')).toHaveAttribute('aria-label', /Tester/);
  await expect(page.locator('.vx-topbar-signin')).toHaveCount(0);
});
