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

test('signed in, the app opens with the account in the top bar', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
  await expect(page.locator('.vx-avatar')).toHaveAttribute('aria-label', /Tester/);
});
