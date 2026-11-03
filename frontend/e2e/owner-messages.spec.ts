/**
 * The owner's top message bar loads after first paint (a lazy chunk, to keep
 * the first-load bundle in budget) and still shows the owner's message and its
 * close button, which keeps it closed after a reload.
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

async function setup(page: Page, broadcast: Record<string, unknown> | null): Promise<void> {
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'client') return route.fulfill({ json: { broadcast } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

test('the owner’s message bar shows after first paint, and stays closed once closed', async ({ page }) => {
  await setup(page, { id: 'b-1', text: 'New: VinaX AI projects are here', link: '/vinaxai/projects', style: 'info' });
  await page.goto('/library');
  const bar = page.getByRole('status').filter({ hasText: 'New: VinaX AI projects are here' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Close message' }).click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('New: VinaX AI projects are here')).toHaveCount(0);
});

test('with no message, there is no bar', async ({ page }) => {
  await setup(page, null);
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Close message' })).toHaveCount(0);
});
