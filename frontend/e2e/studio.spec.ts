import { test, expect, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

async function setup(page: Page, theme: string) {
  await page.addInitScript(({ theme, fp }) => {
    // Set once so a reload exercises persistence instead of resetting state.
    if (localStorage.getItem('studio-test-seeded')) return;
    localStorage.setItem('studio-test-seeded', '1');
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'], festivalSkins: false }, version: 2 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Alex'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('alex'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { theme, fp: latestNotesFingerprint() });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

for (const size of [{ width: 1440, height: 1000, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }]) {
  test(`Home and Radio fit ${size.width}px ${size.theme}, and nothing calls an AI route`, async ({ page }) => {
    await page.setViewportSize(size);
    await setup(page, size.theme);
    const errors: string[] = [];
    const retiredRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      // 1.3 — VinaX has no AI: none of the removed AI routes is ever called.
      if (['/api/dj', '/api/home', '/api/curate', '/api/embed', '/api/playlist', '/api/vinaxai', '/api/aimodels', '/api/voices', '/api/tts', '/api/transcribe'].includes(url.pathname) || url.pathname.startsWith('/api/ai/') || url.searchParams.get('key') === 'home-config') retiredRequests.push(url.pathname);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.vx-home')).toBeVisible();
    await expect(page.locator('.vx-layout-toggle')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto('/radio');
    await expect(page.getByRole('heading', { name: 'Radio', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/radio-${size.width}.png` });
    expect(errors).toEqual([]);
    expect(retiredRequests).toEqual([]);
  });
}
