/**
 * 13.0 — VinaX needs a Google account. Signed out (?e2e-signed-out keeps the
 * test account away, see support/playwright-test.ts), every app page is the
 * sign-in screen; the legal pages stay readable. Signed in, the app opens.
 */
import { expect, test } from '@playwright/test';

test('signed out, every page is the sign-in screen; the legal pages stay readable', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  for (const path of ['/', '/search', '/library', '/settings', '/VinaXAI']) {
    await page.goto(`${path}?e2e-signed-out`);
    await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toBeVisible();
    await expect(page.getByText('Sign in with your Google account to start listening.', { exact: false })).toBeVisible();
    await expect(page.locator('nav')).toHaveCount(0);
  }
  await page.goto('/privacy?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Your account and what syncs' })).toBeVisible();
  await page.goto('/terms?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
});

test('13.3.0: the sign-in screen explains VinaX, and carries no ads', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/?e2e-signed-out');
  for (const name of ['What you get', 'Free, and how it stays free', 'What signing in shares', 'Questions']) {
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  await page.getByText('Does VinaX see my Google password?').click();
  await expect(page.getByText('Never your password', { exact: false })).toBeVisible();
  await expect(page.locator('script[src*="googlesyndication"], ins.adsbygoogle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in and start listening' }).click();
  // Smooth scroll: wait for the title to come back on screen.
  await page.waitForFunction(() => {
    const r = document.getElementById('vx-signin-title')?.getBoundingClientRect();
    return !!r && r.top >= 0 && r.bottom <= innerHeight;
  });
});

test('13.3.0: when Google’s script is blocked, the screen says why and Try again redraws the button', async ({ page }) => {
  let blocked = true;
  await page.route('**/accounts.google.com/**', (r) => (blocked ? r.abort() : r.fulfill({ contentType: 'text/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(el){el.textContent="google-button"},disableAutoSelect(){}}}};' })));
  await page.goto('/?e2e-signed-out');
  await expect(page.getByRole('alert').filter({ hasText: 'Google sign-in couldn’t load' })).toBeVisible();
  await expect(page.getByText('sign in later in Settings', { exact: false })).toHaveCount(0);
  blocked = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('google-button')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('signed in, the app opens with the account in the top bar', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
  await expect(page.locator('.vx-avatar')).toHaveAttribute('aria-label', /Tester/);
});

test('13.4.0: the sign-in card has What you get on its left and Free on its right; no "What you get with VinaX" link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/?e2e-signed-out');
  await expect(page.getByText('What you get with VinaX')).toHaveCount(0);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const card = await box('.vx-signin-card');
  const left = await box('.vx-signin-side.is-left');
  const right = await box('.vx-signin-side.is-right');
  expect(left.x + left.width).toBeLessThanOrEqual(card.x);
  expect(right.x).toBeGreaterThanOrEqual(card.x + card.width);
  // All three sit on the first screen.
  for (const b of [card, left, right]) expect(b.y + b.height).toBeLessThanOrEqual(900);
});

test('13.4.0: About, Help and Get the app open signed out', async ({ page }) => {
  for (const path of ['/about', '/help', '/download']) {
    await page.goto(`${path}?e2e-signed-out`);
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
  }
});

test('13.4.0: the avatar opens profile and app settings, and Sign out signs out', async ({ page }) => {
  // A returning listener: no first-run sheet over the top bar.
  await page.addInitScript(() => {
    if (!localStorage.getItem('vinax.onboarded.v1')) localStorage.setItem('vinax.onboarded.v1', 'true');
  });
  await page.goto('/library');
  // What's new opens once for a version this browser hasn't seen; close it.
  const whatsNew = page.getByRole('button', { name: 'Let’s go' });
  await page.waitForTimeout(1500);
  if (await whatsNew.isVisible()) await whatsNew.click();
  // A festival-day greeting opens ~1.2 s after boot; the harness closes it
  // with Escape, which would also close this menu — let it come and go first.
  await page.waitForTimeout(1800);
  if (await page.locator('.fest-splash').count()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.fest-splash')).toHaveCount(0);
  }
  await page.getByRole('button', { name: /profile and settings/ }).click();
  const menu = page.getByRole('menu', { name: 'Profile and settings' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Profile settings')).toBeVisible();
  await expect(menu.getByText('App settings')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Account & sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: /profile and settings/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toBeVisible();
});
