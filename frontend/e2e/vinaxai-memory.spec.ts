/**
 * VinaX AI memory, in a real browser against the built app, with /api/ai/*
 * answered by a small in-test server: Settings → Memory (the two switches,
 * the list, delete one, add, forget everything), an incognito chat that
 * sends its flag with every message and says so in the header, and
 * accessibility scans of the Memory settings and the incognito chat across
 * the app's styles, dark, light, black and high contrast, at phone width too.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'test:model-a', name: 'Model A', provider: 'Test' };
const MODELS = {
  enabled: true,
  configured: true,
  groups: ['balanced'],
  models: [{ ...MODEL, group: 'balanced', description: 'Strong all-rounder', flags: { vision: false, web: false, thinking: true, code: false }, available: true }],
};
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

interface Item { id: string; text: string; origin: 'chat' | 'user'; createdAt: string }
interface Server {
  items: Item[];
  prefs: { use: boolean; learn: boolean };
  puts: Array<Record<string, unknown>>;
  deleted: string[];
  chats: Array<Record<string, unknown>>;
}

const seedItems = (): Item[] => [
  { id: '33333333-3333-4333-8333-333333333331', text: 'Is learning Carnatic vocals', origin: 'chat', createdAt: '2026-11-01T10:00:00Z' },
  { id: '33333333-3333-4333-8333-333333333332', text: 'Prefers answers in Telugu', origin: 'user', createdAt: '2026-11-01T11:00:00Z' },
];

async function setup(page: Page, opts: { theme?: 'dark' | 'light' | 'amoled'; template?: string; highContrast?: boolean } = {}): Promise<Server> {
  const server: Server = { items: seedItems(), prefs: { use: true, learn: true }, puts: [], deleted: [], chats: [] };
  await page.addInitScript(({ fp, theme, template, highContrast }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, ...(template ? { template } : {}), highContrast, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark', template: opts.template ?? null, highContrast: !!opts.highContrast });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    const p = url.pathname;
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (p === '/api/ai/memories') {
      if (req.method() === 'POST') {
        const { text } = req.postDataJSON() as { text: string };
        const item: Item = { id: crypto.randomUUID(), text, origin: 'user', createdAt: new Date().toISOString() };
        server.items.push(item);
        return route.fulfill({ status: 201, json: { item } });
      }
      if (req.method() === 'DELETE') {
        const removed = server.items.length;
        server.items = [];
        server.deleted.push('all');
        return route.fulfill({ json: { ok: true, removed } });
      }
      return route.fulfill({ json: { enabled: true, prefs: server.prefs, items: server.items, max: 50 } });
    }
    if (p === '/api/ai/memories/prefs') {
      const body = req.postDataJSON() as Record<string, unknown>;
      server.puts.push(body);
      server.prefs = { ...server.prefs, ...body };
      return route.fulfill({ json: { prefs: server.prefs } });
    }
    const one = /^\/api\/ai\/memories\/([^/]+)$/.exec(p);
    if (one && req.method() === 'DELETE') {
      server.items = server.items.filter((i) => i.id !== one[1]);
      server.deleted.push(one[1]);
      return route.fulfill({ json: { ok: true } });
    }
    if (p === '/api/ai/chat') {
      server.chats.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([['meta', { conversationId: C1, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), model: MODEL }], ['text', { delta: 'Here you go.' }], ['done', { stopReason: 'end' }]]),
      });
    }
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const openMemory = async (page: Page) => {
  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'VinaX AI settings' });
  await dialog.getByRole('button', { name: 'Memory', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Memory' })).toBeVisible();
  return dialog;
};

const axe = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  const results = await (include ? builder.include(include) : builder).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
};

test('Settings → Memory lists what VinaX AI remembers; delete one, add one, forget everything', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const dialog = await openMemory(page);
  const list = dialog.getByRole('list', { name: /What VinaX AI remembers \(2\)/ });
  await expect(list.getByText('Is learning Carnatic vocals')).toBeVisible();
  await expect(list.getByText(/Added by you/)).toBeVisible();

  // Delete one from the keyboard: focus moves to the next Delete, never out of the dialog.
  await dialog.getByRole('button', { name: 'Delete memory: Is learning Carnatic vocals' }).focus();
  await page.keyboard.press('Enter');
  await expect(list.getByText('Is learning Carnatic vocals')).toHaveCount(0);
  expect(server.deleted).toEqual(['33333333-3333-4333-8333-333333333331']);
  await expect(dialog.getByRole('button', { name: 'Delete memory: Prefers answers in Telugu' })).toBeFocused();

  await dialog.getByLabel('Add a memory').fill('Plays the veena');
  await dialog.getByLabel('Add a memory').press('Enter');
  await expect(dialog.getByRole('list').getByText('Plays the veena')).toBeVisible();
  expect(server.items.map((i) => i.text)).toContain('Plays the veena');

  await dialog.getByRole('button', { name: 'Forget everything' }).click();
  const ask = dialog.getByRole('group', { name: /Forget everything VinaX AI remembers/ });
  await expect(ask.getByRole('button', { name: 'Keep' })).toBeFocused();
  await ask.getByRole('button', { name: 'Forget all 2' }).click();
  await expect(dialog.getByText(/Nothing yet/)).toBeVisible();
  expect(server.deleted).toContain('all');
});

test('the switches save to the account; Learn is off while memory is off', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const dialog = await openMemory(page);
  await dialog.getByRole('switch', { name: /Learn from my chats/ }).click();
  await expect.poll(() => server.puts).toEqual([{ learn: false }]);
  await dialog.getByRole('switch', { name: /Use memory/ }).click();
  await expect.poll(() => server.puts.length).toBe(2);
  expect(server.puts[1]).toEqual({ use: false });
  await expect(dialog.getByRole('switch', { name: /Learn from my chats/ })).toBeDisabled();
  // Kept with the account: a fresh load shows them as saved.
  await page.goto('/vinaxai');
  const again = await openMemory(page);
  await expect(again.getByRole('switch', { name: /Use memory/ })).toHaveAttribute('aria-checked', 'false');
});

test('an incognito chat sends its flag with every message and says so; a normal chat sends none', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  const toggle = page.getByRole('button', { name: 'Incognito chat' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Incognito chat' })).toBeVisible();
  await expect(page.getByText(/won’t use or add to its memory of you in this chat/)).toBeVisible();
  await box.fill('A private question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => server.chats.length).toBe(1);
  expect(server.chats[0].incognito).toBe(true);
  // Started: the choice is fixed and the header says so.
  await expect(page.getByRole('button', { name: 'Incognito chat' })).toHaveCount(0);
  await expect(page.locator('.vx-ai-incognito-badge')).toHaveText(/Incognito/);
  await expect(page.getByText('Here you go.', { exact: true })).toBeVisible();
  await box.fill('And another');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => server.chats.length).toBe(2);
  expect(server.chats[1].incognito).toBe(true);

  // A new chat is a normal one again.
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('button', { name: 'Incognito chat' })).toHaveAttribute('aria-pressed', 'false');
  await box.fill('A normal question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => server.chats.length).toBe(3);
  expect(server.chats[2]).not.toHaveProperty('incognito');
});

const LOOKS: Array<{ theme: 'dark' | 'light' | 'amoled'; template: string; highContrast?: boolean }> = [
  ...['lumen', 'verdant', 'monsoon', 'harbour', 'verse', 'onyx'].flatMap((template) => (['dark', 'light'] as const).map((theme) => ({ theme, template }))),
  { theme: 'amoled', template: 'lumen' },
  { theme: 'dark', template: 'lumen', highContrast: true },
  { theme: 'light', template: 'lumen', highContrast: true },
];
for (const look of LOOKS) {
  test(`no WCAG A/AA violations in Memory settings and an incognito chat: ${look.template}, ${look.theme}${look.highContrast ? ', high contrast' : ''}`, async ({ page }) => {
    await setup(page, look);
    await page.goto('/vinaxai');
    await page.getByRole('button', { name: 'Incognito chat' }).click();
    await expect(page.getByRole('heading', { name: 'Incognito chat' })).toBeVisible();
    await axe(page);
    const dialog = await openMemory(page);
    await expect(dialog.getByText('Is learning Carnatic vocals')).toBeVisible();
    await axe(page, '.vx-ai-settings');
  });
}

test('phone width: Memory settings fit and the incognito chat passes a scan', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await setup(page, { theme: 'light' });
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Incognito chat' }).click();
  await axe(page);
  const dialog = await openMemory(page);
  const add = dialog.getByRole('button', { name: 'Add', exact: true });
  await dialog.getByLabel('Add a memory').scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport();
  const overflow = await page.evaluate(() => document.querySelector('.vx-ai-settings-body')!.scrollWidth - document.querySelector('.vx-ai-settings-body')!.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await axe(page, '.vx-ai-settings');
});
