/**
 * Owner console — VinaX AI (phase 7) against a mocked Worker: Health → VinaX
 * AI shows keys as set or missing, rests and last errors, and probes each
 * enabled model one at a time on a button press; Publish → VinaX AI edits
 * the switch, testers, web search and model switches as a form and writes
 * the JSON the Worker reads. Zero page or console errors allowed.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';

const now = Date.now();
const iso = (minutesAhead: number) => new Date(now + minutesAhead * 60_000).toISOString();
const AI = {
  settings: { enabled: false, testers: ['1001'], search: true, overrides: 1 },
  providers: [
    { id: 'groq', name: 'Groq', configured: true, restingUntil: null, lastError: null },
    { id: 'gemini', name: 'Google Gemini', configured: true, restingUntil: null, lastError: { kind: 'rate', status: 429, at: iso(-5) } },
    { id: 'nvidia', name: 'NVIDIA', configured: false, restingUntil: null, lastError: null },
  ],
  models: [
    { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq', group: 'balanced', ownerEnabled: true, order: null, configured: true, restingUntil: null, restKind: null },
    { id: 'gemini:gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Google Gemini', group: 'vision', ownerEnabled: true, order: null, configured: true, restingUntil: iso(8), restKind: 'rate' },
    { id: 'groq:qwen/qwen3-32b', name: 'Qwen3 32B', provider: 'Groq', group: 'fast', ownerEnabled: false, order: null, configured: true, restingUntil: null, restKind: null },
    { id: 'nvidia:x', name: 'Nemotron', provider: 'NVIDIA', group: null, ownerEnabled: true, order: null, configured: false, restingUntil: null, restKind: null },
  ],
  search: { api: { configured: true, provider: 'tavily', dailyLimit: 100, usedToday: 3 }, grounding: { configured: true, dailyLimit: 450, usedToday: 12 } },
  voice: { dictation: true, readAloud: true, live: true, resting: [] },
  checkedAt: iso(0),
};

interface Backend { probes: string[]; settings: Array<{ key: string; value: unknown }> }

async function open(page: Page, hash: string): Promise<{ backend: Backend; errors: string[] }> {
  const backend: Backend = { probes: [], settings: [] };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(() => sessionStorage.setItem('vinax_admin_token', 'owner-pass'));
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
    if (url.pathname === '/api/admin/ai' && req.method() === 'POST') {
      backend.probes.push(body.model);
      return route.fulfill({ json: body.model.startsWith('gemini') ? { model: body.model, ok: false, ms: 900, firstTokenMs: null, kind: 'rate', status: 429 } : { model: body.model, ok: true, ms: 640, firstTokenMs: 410 } });
    }
    if (url.pathname === '/api/admin/ai') return route.fulfill({ json: AI });
    if (url.pathname === '/api/admin/settings' && req.method() === 'POST') {
      backend.settings.push(body);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === '/api/admin/settings') {
      return route.fulfill({ json: {
        configured: true,
        keys: [{ key: 'vinax-ai', group: 'App', title: 'VinaX AI', note: '', shape: 'object' }],
        values: { 'vinax-ai': { enabled: false, testers: ['1001'], search: true, models: { 'groq:qwen/qwen3-32b': { enabled: false }, 'openrouter:gone-model': { enabled: false } } } },
        updated: {},
      } });
    }
    if (url.pathname === '/api/admin/envcheck') return route.fulfill({ json: { items: [], missingRequired: [] } });
    return route.fulfill({ json: { configured: true } });
  });
  await page.goto(`/admin/${hash}`);
  return { backend, errors };
}

test('Health → VinaX AI: keys, rests, last errors, and a probe of each enabled model', async ({ page }) => {
  const { backend, errors } = await open(page, '#/health/ai');
  const body = page.locator('#pageBody');
  await expect(body).toContainText('VinaX AI is off for listeners; 1 tester can use it.');
  await expect(body).toContainText('2 / 3');
  await expect(body.getByRole('row', { name: /NVIDIA.*Missing/ })).toBeVisible();
  await expect(body.getByRole('row', { name: /Google Gemini.*Rate limited.*HTTP 429/ })).toBeVisible();
  await expect(body.getByRole('row', { name: /Gemini 3.6 Flash/ })).toContainText('Rate limited');
  await expect(body).not.toContainText('secret');

  await body.getByRole('button', { name: 'Probe enabled models' }).click();
  await expect(body).toContainText('Probed 2 models');
  // Only models with a key and switched on, one request each, in order.
  expect(backend.probes).toEqual(['groq:openai/gpt-oss-120b', 'gemini:gemini-3.6-flash']);
  await expect(body.getByRole('row', { name: /GPT-OSS 120B/ })).toContainText('OK · 410 ms');
  await expect(body.getByRole('row', { name: /Gemini 3.6 Flash/ }).getByText('Rate limited').last()).toBeVisible();
  expect(errors).toEqual([]);

  const results = await new AxeBuilder({ page }).include('#pageBody').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('Publish → VinaX AI: the form writes the switch, testers, web search and model switches', async ({ page }) => {
  const { backend, errors } = await open(page, '#/publish?key=vinax-ai');
  const body = page.locator('#pageBody');
  await expect(body.getByLabel('GPT-OSS 120B on')).toBeChecked();
  await expect(body.getByLabel('Qwen3 32B on')).not.toBeChecked();
  await body.getByLabel('VinaX AI on for everyone').check({ force: true });
  await body.getByLabel('Testers').fill('1001\n2002');
  await body.getByLabel('Web search').uncheck({ force: true });
  await body.getByLabel('Gemini 3.6 Flash on').uncheck({ force: true });
  await body.getByLabel('GPT-OSS 120B order').fill('-1');
  await body.getByRole('button', { name: 'Publish' }).click();
  await expect.poll(() => backend.settings.length).toBe(1);
  expect(backend.settings[0]).toEqual({
    key: 'vinax-ai',
    value: {
      enabled: true,
      testers: ['1001', '2002'],
      search: false,
      models: {
        // An id the Worker no longer lists keeps its old entry.
        'openrouter:gone-model': { enabled: false },
        'groq:openai/gpt-oss-120b': { order: -1 },
        'gemini:gemini-3.6-flash': { enabled: false },
        'groq:qwen/qwen3-32b': { enabled: false },
      },
    },
  });
  expect(errors).toEqual([]);
});
