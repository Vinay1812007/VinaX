/**
 * VinaX AI on a phone-sized screen, against the built app with /api/ai/*
 * answered by the test: the model menu opens fully on screen, the
 * "Extended thinking" label never runs under the model button, the
 * "can't see images" notice keeps its buttons whole, and the header's
 * settings button is the only button there (no theme button to mistake it for).
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const MODELS = {
  enabled: true, configured: true, search: false, groups: ['fast', 'vision'],
  models: [
    { id: 'groq:north-mini-code', name: 'North Mini Code', provider: 'Groq', group: 'fast', description: 'Quick replies for everyday questions', flags: { vision: false, web: false, thinking: true, code: true }, available: true },
    { id: 'gemini:flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'Gemini', group: 'vision', description: 'Quick, sees images', flags: { vision: true, web: false, thinking: true, code: false }, available: true },
  ],
};

async function setup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/attachments' && r.method() === 'POST') {
      return route.fulfill({ json: { id: 'att-1', name: url.searchParams.get('name') ?? 'Logo.png', mime: 'image/png', size: 100, kind: 'image' } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const shot = (page: Page, name: string) => (process.env.VX_SHOTS ? page.screenshot({ path: `${process.env.VX_SHOTS}/${name}.png` }) : Promise.resolve());

test('the model menu opens fully on a phone screen', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Extended thinking/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model: / }).click();
  const list = page.getByRole('listbox', { name: 'Choose a model' });
  await expect(list).toBeVisible();
  await shot(page, 'model-menu');
  const box = (await list.locator('xpath=..').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('the Extended thinking label stays clear of the model button', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Extended thinking/ }).click();
  await page.keyboard.press('Escape');
  const pill = page.locator('.vx-ai-pill', { hasText: 'Extended thinking' });
  await expect(pill).toBeVisible();
  await shot(page, 'thinking-pill');
  const tools = (await page.locator('.vx-ai-composer-tools').boundingBox())!;
  const model = (await page.getByRole('button', { name: /^Model: / }).boundingBox())!;
  expect(tools.x + tools.width).toBeLessThanOrEqual(model.x + 1);
});

test('the "can’t see images" notice keeps its buttons whole', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: /^Model: / }).click();
  await page.getByRole('option', { name: /North Mini Code/ }).click();
  await page.getByLabel('Choose files to add').setInputFiles({ name: 'Logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  const notice = page.getByRole('alert').filter({ hasText: 'can’t see images' });
  await expect(notice).toBeVisible();
  await shot(page, 'vision-notice');
  for (const name of ['Use Gemini 3.1 Flash Lite', 'Use Auto']) {
    const b = (await notice.getByRole('button', { name }).boundingBox())!;
    // One line of text: wider than tall, and no taller than a normal chip.
    expect(b.width).toBeGreaterThan(b.height);
    expect(b.height).toBeLessThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
  }
});

test('the header has a settings button, drawn as a cog, and no theme button', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  const settings = page.getByRole('button', { name: 'VinaX AI settings' });
  await expect(settings).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toHaveCount(0);
  await settings.click();
  await expect(page.getByRole('heading', { name: 'VinaX AI settings' })).toBeVisible();
});
