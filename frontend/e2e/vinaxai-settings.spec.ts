/**
 * VinaX AI's settings (General, Personalisation) and live previews in
 * replies, against the built app with /api/ai/* answered by the test: the
 * theme changes the whole app, Personalisation goes with each message, the
 * Artifacts switch reaches the request, a finished html artifact shows a
 * preview in the reply (and none with the switch off), and the panel passes
 * an accessibility scan in dark and light.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const MODELS = {
  enabled: true, configured: true, search: false, groups: ['balanced'],
  models: [{ ...MODEL, group: 'balanced', description: 'Strong all-rounder', flags: { vision: false, web: false, thinking: true, code: false }, available: true }],
};
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const PAGE = '<artifact id="bar-chart" type="html" title="Plays by month"><!doctype html><html><body><h1>Plays</h1></body></html></artifact>';

async function setup(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<Array<Record<string, unknown>>> {
  const posted: Array<Record<string, unknown>> = [];
  await page.addInitScript(({ fp, theme }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme });
  await page.route('**/*', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/chat') {
      posted.push(r.postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([['meta', { conversationId: C1, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), model: MODEL }], ['text', { delta: `Here is a chart. ${PAGE}` }], ['done', { stopReason: 'end' }]]),
      });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return posted;
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  return page.getByRole('dialog', { name: 'VinaX AI settings' });
};

test('Appearance changes the whole app’s theme', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('heading', { name: 'General' })).toBeVisible();
  await dialog.getByLabel('Appearance').selectOption('light');
  await expect(page.locator('html')).toHaveClass(/\blight\b/);
  await dialog.getByLabel('Appearance').selectOption('dark');
  await expect(page.locator('html')).not.toHaveClass(/\blight\b/);
});

test('Personalisation and the Artifacts switch go with each message', async ({ page }) => {
  const posted = await setup(page);
  await page.goto('/vinaxai');
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Personalisation' }).click();
  await dialog.getByLabel('What should VinaX AI call you?').fill('Ash');
  await dialog.getByLabel('What should VinaX AI know about you?').fill('I play the sitar.');
  await dialog.getByLabel('How should VinaX AI reply?').fill('Keep it short.');
  await dialog.getByLabel('Reply style').selectOption('learning');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('Teach me a raga');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ artifacts: true, personal: { name: 'Ash', about: 'I play the sitar.', instructions: 'Keep it short.', style: 'learning' } });
  // Kept on this device across a fresh load (the test server knows no saved chats, so start a new one).
  await page.goto('/vinaxai');
  const again = await openSettings(page);
  await expect(again.getByLabel('What should VinaX AI call you?')).toHaveValue('Ash');
  await again.getByRole('switch', { name: /^Artifacts/ }).click();
  await expect(again.getByRole('switch', { name: /Live previews in replies/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('Again');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1].artifacts).toBe(false);
});

test('a finished page or chart shows as a live preview in the reply, unless switched off', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('Chart my plays');
  await page.getByRole('button', { name: 'Send message' }).click();
  const preview = page.locator('.vx-ai-inline-preview');
  await expect(preview).toHaveCount(1);
  await expect(preview.locator('iframe[title="Preview: Plays by month (in the reply)"]')).toHaveAttribute('sandbox', 'allow-scripts allow-modals');
  const dialog = await openSettings(page);
  await dialog.getByRole('switch', { name: /Live previews in replies/ }).click();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  // The card that opens the full panel stays.
  await expect(page.getByRole('button', { name: /Plays by month/ })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the settings panel has no WCAG A/AA violations: ${theme}`, async ({ page }) => {
    await setup(page, theme);
    await page.goto('/vinaxai');
    await openSettings(page);
    const results = await new AxeBuilder({ page }).include('.vx-ai-settings').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
