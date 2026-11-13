/**
 * Schema 20 — Settings › Account › Password. Closed, it is a row with its
 * button on the right; open, the form spans the row's full width under the
 * label (it used to be squeezed into the narrow control column on a computer).
 */
import { expect, test } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

for (const [name, viewport] of [['computer', { width: 1280, height: 900 }], ['phone', { width: 390, height: 900 }]] as const) {
  test(`password row: the open form uses the full width on a ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((fp) => {
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    }, latestNotesFingerprint());
    await page.goto('/settings');
    const open = page.getByRole('button', { name: /^(Set a password|Change password)$/ });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const block = page.locator('[data-settings-row].is-block', { hasText: 'Password' });
    const form = block.locator('form.vx-email-form');
    await expect(form.getByText('Type it again')).toBeVisible();
    await expect(block).toBeVisible();
    const [row, box] = await Promise.all([block.boundingBox(), form.boundingBox()]);
    // The form starts at the row's left edge and is as wide as the row allows (max 360 px).
    expect(box!.x - row!.x).toBeLessThan(40);
    expect(box!.width).toBeGreaterThanOrEqual(Math.min(340, row!.width - 40));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);
  });
}
