/**
 * VinaX AI, phase 2 (the Claude-style interface), in a real browser against
 * the built app, with /api/ai/* answered by a small in-test server:
 * the sidebar (search, star, rename, delete), the model picker, edit and the
 * version switcher, Continue, a picked model's failure with alternatives,
 * maths, the phone drawer, the entry points, and an accessibility scan in
 * every app style, light and dark.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const C2 = '1c7d3a7f-2d2f-4c62-8b68-4e2a4f3b0c21';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const MODELS = {
  enabled: true,
  configured: true,
  groups: ['fast', 'balanced', 'vision'],
  models: [
    { id: 'groq:qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'Groq', group: 'fast', description: 'Quickest replies', flags: { vision: false, web: false, thinking: true, code: false }, available: true },
    { ...MODEL, group: 'balanced', description: 'Strong all-rounder', flags: { vision: false, web: false, thinking: true, code: false }, available: true },
    { id: 'nvidia:vl', name: 'Nemotron 3.5 Super VL', provider: 'NVIDIA', group: 'vision', description: 'Reads images', flags: { vision: true, web: false, thinking: true, code: false }, available: false, reason: 'busy' },
  ],
};
const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

interface Server {
  posted: Array<Record<string, unknown>>;
  patched: Array<{ id: string; body: Record<string, unknown> }>;
  deleted: string[];
  chat: (body: Record<string, unknown>) => { status?: number; body: string };
}

async function setup(page: Page, opts: { theme?: 'dark' | 'light'; template?: string } = {}): Promise<Server> {
  const server: Server = {
    posted: [],
    patched: [],
    deleted: [],
    chat: (body) => ({
      body: sse([
        ['meta', { conversationId: (body.conversationId as string) ?? C1, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), model: MODEL }],
        ['text', { delta: `Reply to ${JSON.stringify((body.content as Array<{ text?: string }>)[0]?.text ?? 'retry')}` }],
        ['done', { stopReason: 'end' }],
      ]),
    }),
  };
  const convs = [
    { id: C1, title: 'Raga Yaman', starred: false, activeLeafId: 'a1', createdAt: now, updatedAt: now },
    { id: C2, title: 'Old chat about tabla', starred: true, activeLeafId: null, createdAt: yesterday, updatedAt: yesterday },
  ];
  const tree = {
    conversation: convs[0],
    messages: [
      { id: 'u1', parentId: null, role: 'user', content: [{ type: 'text', text: 'What is raga Yaman?' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: '2026-10-30T10:00:00Z' },
      { id: 'a1', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: 'Yaman is an evening raga whose' }], thinking: 'Recall the thaat.', thinkingMs: 4000, model: MODEL, stopReason: 'length', createdAt: '2026-10-30T10:00:01Z' },
    ],
  };
  await page.addInitScript(({ fp, theme, template }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, ...(template ? { template } : {}), pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark', template: opts.template ?? null });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const p = url.pathname;
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/chat') {
      const body = req.postDataJSON() as Record<string, unknown>;
      server.posted.push(body);
      const out = server.chat(body);
      return route.fulfill({ status: out.status ?? 200, contentType: 'text/event-stream', body: out.body });
    }
    if (p === '/api/ai/conversations') {
      const q = url.searchParams.get('q');
      const items = convs.filter((c) => !server.deleted.includes(c.id) && (!q || (c.title ?? '').toLowerCase().includes(q.toLowerCase())));
      return route.fulfill({ json: { items, nextCursor: null } });
    }
    const m = /^\/api\/ai\/conversations\/([^/]+)$/.exec(p);
    if (m) {
      if (req.method() === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        server.patched.push({ id: m[1], body });
        const c = convs.find((x) => x.id === m[1])!;
        Object.assign(c, body.title ? { title: body.title } : {}, typeof body.starred === 'boolean' ? { starred: body.starred } : {});
        return route.fulfill({ json: { conversation: c } });
      }
      if (req.method() === 'DELETE') {
        server.deleted.push(m[1]);
        return route.fulfill({ json: { ok: true } });
      }
      if (m[1] === C1) return route.fulfill({ json: tree });
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    }
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message VinaX AI' });

test('the empty state greets, and a suggestion fills the composer without sending', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Tester/ })).toBeVisible();
  await page.getByRole('group', { name: 'Start with' }).getByRole('button', { name: 'Music' }).click();
  await expect(composer(page)).toHaveValue('Recommend songs like ');
  await expect(composer(page)).toBeFocused();
  expect(server.posted).toHaveLength(0);
});

test('the sidebar groups chats, searches, stars, renames and deletes', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const nav = page.getByRole('navigation', { name: 'Chats' });
  await expect(nav.getByRole('heading', { name: 'Starred' })).toBeVisible();
  await expect(nav.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Raga Yaman' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search chats' }).fill('tabla');
  await expect(nav.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Raga Yaman' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search chats' }).fill('');

  await nav.getByRole('button', { name: 'Options for Raga Yaman' }).click();
  await page.getByRole('menuitem', { name: 'Star' }).click();
  await expect.poll(() => server.patched.at(-1)).toEqual({ id: C1, body: { starred: true } });

  await nav.getByRole('button', { name: 'Options for Raga Yaman' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const name = page.getByRole('textbox', { name: 'Chat name' });
  await name.fill('Evening ragas');
  await name.press('Enter');
  await expect.poll(() => server.patched.at(-1)).toEqual({ id: C1, body: { title: 'Evening ragas' } });
  await expect(nav.getByRole('link', { name: 'Evening ragas' })).toBeVisible();

  await nav.getByRole('button', { name: 'Options for Evening ragas' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this chat?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => server.deleted).toEqual([C1]);
  await expect(nav.getByRole('link', { name: 'Evening ragas' })).toHaveCount(0);
});

test('a chosen model is sent, and its failure offers Auto and alternatives', async ({ page }) => {
  const server = await setup(page);
  server.chat = (body) => body.mode === 'model'
    ? { body: sse([
      ['meta', { conversationId: C1, userMessageId: 'u9', assistantMessageId: 'a9', model: { id: 'groq:qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'Groq' } }],
      ['error', { code: 'model_busy', message: 'Qwen 3.8 27B is busy right now.', retryable: true, alternatives: [MODEL] }],
      ['done', { stopReason: 'error' }],
    ]) }
    : { body: sse([['meta', { conversationId: C1, userMessageId: 'u9', assistantMessageId: 'a10', model: MODEL }], ['text', { delta: 'Answered by Auto.' }], ['done', { stopReason: 'end' }]]) };
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Model: Auto' }).click();
  const list = page.getByRole('listbox', { name: 'Choose a model' });
  await expect(list.getByRole('option', { name: /Nemotron 3.5 Super VL/ })).toHaveAttribute('aria-disabled', 'true');
  await list.getByRole('option', { name: /Qwen 3.8 27B/ }).click();
  await expect(page.getByRole('button', { name: 'Model: Qwen 3.8 27B' })).toBeVisible();
  await composer(page).fill('hello there');
  await composer(page).press('Enter');
  await expect(page.getByText('Qwen 3.8 27B is busy right now.')).toBeVisible();
  expect(server.posted[0]).toMatchObject({ mode: 'model', model: 'groq:qwen/qwen3.8-27b' });
  await page.getByRole('button', { name: 'Try with Auto' }).click();
  await expect(page.locator('.vx-ai-md').getByText('Answered by Auto.')).toBeVisible();
  expect(server.posted[1]).toMatchObject({ mode: 'auto', parentMessageId: 'u9', content: [] });
});

test('a saved chat opens on its branch; Continue carries on a cut-off reply; Edit makes a new version', async ({ page }) => {
  const server = await setup(page);
  server.chat = (body) => body.continueFrom
    ? { body: sse([['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL, continued: true }], ['text', { delta: ' tonic is Ni.' }], ['done', { stopReason: 'end' }]]) }
    : { body: sse([['meta', { conversationId: C1, userMessageId: 'u2', assistantMessageId: 'a2', model: MODEL }], ['text', { delta: 'A simpler answer.' }], ['done', { stopReason: 'end' }]]) };
  await page.goto(`/vinaxai/c/${C1}`);
  await expect(page.getByText('The reply was cut short.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thought for 4s' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.vx-ai-md').getByText('Yaman is an evening raga whose tonic is Ni.')).toBeVisible();
  expect(server.posted[0]).toMatchObject({ conversationId: C1, continueFrom: 'a1', content: [] });

  await page.locator('.vx-ai-turn-user').hover();
  await page.getByRole('button', { name: 'Edit message' }).click();
  const edit = page.getByRole('textbox', { name: 'Edit your message' });
  await edit.fill('What is Yaman, simply?');
  await edit.press('Enter');
  await expect(page.locator('.vx-ai-md').getByText('A simpler answer.')).toBeVisible();
  expect(server.posted[1]).toMatchObject({ parentMessageId: 'root', content: [{ type: 'text', text: 'What is Yaman, simply?' }] });
  const versions = page.locator('.vx-ai-turn-user').getByRole('group', { name: 'Versions' });
  await expect(versions).toContainText('2 / 2');
  await versions.getByRole('button', { name: 'Previous version' }).click();
  await expect(page.locator('.vx-ai-bubble')).toHaveText('What is raga Yaman?');
  await expect.poll(() => server.patched.at(-1)).toEqual({ id: C1, body: { activeLeafId: 'a1' } });
});

test('maths renders with KaTeX and prices stay text', async ({ page }) => {
  const server = await setup(page);
  server.chat = () => ({ body: sse([['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }], ['text', { delta: 'Euler: $e^{i\\pi}+1=0$. A ticket costs $5 and $10.' }], ['done', { stopReason: 'end' }]]) });
  await page.goto('/vinaxai');
  await composer(page).fill('maths please');
  await composer(page).press('Enter');
  await expect(page.locator('.vx-ai-md .katex')).toHaveCount(1);
  await expect(page.locator('.vx-ai-md')).toContainText('A ticket costs $5 and $10.');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the sidebar is a drawer from ☰ that closes on a choice and on Escape', async ({ page }) => {
    await setup(page);
    await page.goto('/vinaxai');
    await expect(page.getByRole('navigation', { name: 'Chats' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open chats' }).click();
    const drawer = page.getByRole('dialog', { name: 'Chats' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: 'Open chats' }).click();
    await page.getByRole('dialog', { name: 'Chats' }).getByRole('link', { name: 'Raga Yaman' }).click();
    await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C1}$`));
    await expect(page.getByRole('dialog', { name: 'Chats' })).toHaveCount(0);
    await expect(page.locator('.vx-ai-bubble')).toHaveText('What is raga Yaman?');
  });
});

test('VinaX AI is in the side navigation and the command palette', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'VinaX AI' }).click();
  await expect(page).toHaveURL(/\/vinaxai$/);
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('VinaX AI');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/vinaxai$/);
});

for (const template of ['lumen', 'verdant', 'monsoon', 'harbour', 'verse', 'onyx']) {
  for (const theme of ['dark', 'light'] as const) {
    test(`no WCAG A/AA violations: ${template}, ${theme}`, async ({ page }) => {
      const server = await setup(page, { theme, template });
      server.chat = () => ({ body: sse([
        ['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }],
        ['thinking', { delta: 'Think.' }],
        ['text', { delta: 'A **reply** with a [link](https://example.com), a table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```' }],
        ['done', { stopReason: 'length' }],
      ]) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/vinaxai');
      await composer(page).fill('scan me');
      await composer(page).press('Enter');
      await expect(page.getByText('GPT-OSS 120B · Groq')).toBeVisible();
      await page.getByRole('button', { name: 'Model: Auto' }).click();
      await expect(page.getByRole('listbox', { name: 'Choose a model' })).toBeVisible();
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    });
  }
}
