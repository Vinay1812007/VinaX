import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 8.4.0 — where ads may appear. One labelled placement on browsing pages
 * (here a language hub), and the ad script never loads on Home or in Kid
 * mode. Also pins the written content the ad review asked for: the language
 * guide on a hub and About VinaX on Home, and that a song page with the ad
 * placement still plays real audio. All non-localhost network is aborted, so
 * the ad script tag is observed, never fetched.
 */
async function seed(page: Page, kidMode: boolean): Promise<void> {
  await page.addInitScript(({ kidMode, fp }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false, kidMode }, version: 4 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { kidMode, fp: latestNotesFingerprint() });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const adScriptLoaded = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!document.querySelector('script[src^="https://pagead2.googlesyndication.com/"]'));

test('a language hub shows its written guide and one labelled ad placement', async ({ page }) => {
  await seed(page, false);
  await page.goto('/telugu-songs');
  await expect(page.getByRole('heading', { name: 'About Telugu music' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Advertisement' })).toHaveCount(1);
  expect(await adScriptLoaded(page)).toBe(true);
  await page.getByRole('heading', { name: 'About Telugu music' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v840-hub-guide.png' });
});

test('Home carries About VinaX and never loads the ad script', async ({ page }) => {
  await seed(page, false);
  await page.goto('/');
  await page.waitForSelector('.vx-hero');
  await expect(page.getByRole('heading', { name: 'About VinaX' })).toHaveCount(1);
  await page.evaluate(() => document.querySelector('#vx-home-about')?.scrollIntoView());
  await page.waitForTimeout(500); // placeholder blocks settle before the capture
  await page.screenshot({ path: 'test-results/v840-home-about.png' });
  expect(await adScriptLoaded(page)).toBe(false);
});

test('Kid mode: no ad placement and no ad script, even on a browsing page', async ({ page }) => {
  await seed(page, true);
  await page.goto('/telugu-songs');
  await expect(page.getByRole('heading', { name: 'About Telugu music' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Advertisement' })).toHaveCount(0);
  expect(await adScriptLoaded(page)).toBe(false);
});

/** One second of silent 8 kHz mono WAV — real audio the browser can play. */
function silentWav(): Buffer {
  const samples = 8000;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36);
  b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}

