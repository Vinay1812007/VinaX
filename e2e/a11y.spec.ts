/**
 * Automated accessibility gate (delta audit P3-34): axe-core scans of the
 * highest-traffic surfaces, failing the build on serious/critical violations.
 * Not a substitute for the manual work (focus traps, touch targets, contrast
 * tokens — all shipped separately); this keeps regressions out.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

// Scan with animations settled: the page-enter fade (vx-stagger/fade-up)
// renders text at partial opacity for a few hundred ms, and an axe pass that
// lands mid-animation reports phantom color-contrast violations (the
// long-standing "retry passes" flake). prefers-reduced-motion disables the
// animations app-side — the scan then measures the real, settled colors.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function markOnboarded(page: Page): Promise<void> {
  await page.addInitScript(
    ([fp]) => {
      localStorage.setItem('vinax.onboarded', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Smoke'));
      localStorage.setItem('vinax.whatsnew.fingerprint', JSON.stringify(fp));
    },
    [latestNotesFingerprint()],
  );
}

async function goOffline(page: Page): Promise<void> {
  await page.route(/saavn|sirimillavinay|lrclib/, (route) => route.abort());
}

async function scan(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} nodes)`);
}

test('home surface has no serious/critical axe violations', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/');
  await page.waitForSelector('#main-content');
  expect(await scan(page)).toEqual([]);
});

test('settings surface has no serious/critical axe violations', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/settings');
  // Wait for the page CONTENT (not just the shell) — scanning mid-hydration
  // flakes on transient states that never reach users.
  await expect(page.getByRole('heading', { name: 'Recommendations' })).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test('the erase-everything dialog is a real modal now', async ({ page }) => {
  await markOnboarded(page);
  await goOffline(page);
  await page.goto('/settings');
  // Activate via keyboard — the row sits near the bottom edge where the fixed
  // player dock overlaps the minimal scroll position, and keyboard activation
  // is the behavior this test is really about.
  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Erase everything' });
  await expect(dialog).toBeVisible();
  // Focus lands inside; Escape closes and control returns.
  await expect
    .poll(async () =>
      page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
