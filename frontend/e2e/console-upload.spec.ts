import { test, expect, type Page } from './support/test';
import { mockConsole, signedIn, watchErrors } from './support/consoleMocks';

/**
 * The console's picture upload (Send Notification, Home Screen banners).
 *
 * It was broken on every page: the chosen file was shown through a blob:
 * address, which the console's own content policy (img-src 'self' data:
 * https:) refuses, so the crop step never opened and the page said "That
 * file could not be opened as a picture". This runs the real page with its
 * real policy: choose a file, crop, upload.
 */
const STORED = 'https://abc.supabase.co/storage/v1/object/public/console-media/notification/2026-11-10/x.jpg';

/** A real 320 × 200 PNG, drawn in the browser. */
async function png(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2a33a';
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#123';
    g.fillRect(40, 40, 120, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

async function uploads(page: Page): Promise<Array<{ data: string; purpose: string }>> {
  const got: Array<{ data: string; purpose: string }> = [];
  await page.route('**/api/admin/upload', async (route) => {
    got.push(route.request().postDataJSON() as { data: string; purpose: string });
    await route.fulfill({ json: { ok: true, url: STORED, path: 'notification/2026-11-10/x.jpg' } });
  });
  return got;
}

test.describe('console picture upload', () => {
  test('Send Notification: choose a picture, crop it, and it is stored', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    const got = await uploads(page);
    await signedIn(page);
    await page.goto('/admin/#/send-notification');
    const box = page.locator('.img-upload').first();
    await expect(box).toBeVisible();
    await box.locator('input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await png(page) });

    const crop = page.getByRole('dialog', { name: 'Crop the picture' });
    await expect(crop).toBeVisible();
    // The preview really drew (2 : 1, 1024 wide), it is not a broken image.
    await expect.poll(() => crop.locator('img.crop-img').evaluate((i: HTMLImageElement) => `${i.naturalWidth}x${i.naturalHeight}`)).toBe('1024x512');
    await crop.getByRole('button', { name: 'Use this picture' }).click();

    await expect(box).toContainText('Picture saved');
    expect(got).toHaveLength(1);
    expect(got[0].purpose).toBe('notification');
    expect(got[0].data).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]{500,}$/);
    await expect(box.locator('.img-preview img')).toHaveAttribute('src', STORED);
    await expect(box).not.toContainText('could not be opened');
    expect(errors).toEqual([]);
  });

  test('Home Screen: a banner picture is cropped over the banner form, and the form stays open', async ({ page }) => {
    const errors = watchErrors(page);
    await mockConsole(page);
    const got = await uploads(page);
    await signedIn(page);
    await page.goto('/admin/#/app-settings/home-screen');
    await page.getByRole('button', { name: /Add (a )?banner/i }).first().click();
    const form = page.getByRole('dialog', { name: 'Add banner' });
    await expect(form).toBeVisible();
    await form.getByPlaceholder('e.g. New Telugu hits').fill('Diwali hits');
    await form.locator('.img-upload input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: await png(page) });

    const crop = page.getByRole('dialog', { name: 'Crop the picture' });
    await expect(crop).toBeVisible();
    // Escape belongs to the crop step alone: what was typed in the form survives.
    await page.keyboard.press('Escape');
    await expect(crop).toHaveCount(0);
    await expect(form).toBeVisible();
    await expect(form.getByPlaceholder('e.g. New Telugu hits')).toHaveValue('Diwali hits');

    await form.locator('.img-upload input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: await png(page) });
    await expect(crop).toBeVisible();
    await expect.poll(() => crop.locator('img.crop-img').evaluate((i: HTMLImageElement) => `${i.naturalWidth}x${i.naturalHeight}`)).toBe('400x400');
    await crop.getByRole('button', { name: 'Use this picture' }).click();
    await expect(form.locator('.img-upload')).toContainText('Picture saved');
    expect(got).toHaveLength(1);
    expect(got[0].purpose).toBe('banner');
    expect(errors).toEqual([]);
  });

  test('a file that is not a picture is refused with a plain message', async ({ page }) => {
    await mockConsole(page);
    await signedIn(page);
    await page.goto('/admin/#/send-notification');
    const box = page.locator('.img-upload').first();
    await box.locator('input[type="file"]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture at all') });
    await expect(box).toContainText('could not be opened as a picture');
    await expect(page.getByRole('dialog', { name: 'Crop the picture' })).toHaveCount(0);
  });
});
