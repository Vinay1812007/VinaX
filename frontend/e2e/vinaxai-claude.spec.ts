/**
 * VinaX AI, the Claude round (2026-11-18), in a real browser against the
 * built app with /api/ai/* answered by the test: Research from the + menu
 * (the pill, the request, the progress lines, the sources), the recent
 * chats on the welcome and the Chats page with its selection and delete,
 * keyboard shortcuts and their dialog, "Ask about this" on a selection,
 * the reply language and Delete all chats in settings, and accessibility
 * scans of the new pages.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const C2 = '1c7d3a7f-2d2f-4c62-8b68-4e2a4f3b0c21';
const C3 = '2d8e4b80-3e30-4d73-9c79-5f3b5a4c1d32';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const MODELS = { enabled: true, configured: true, search: true, research: true, groups: ['balanced'], models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }] };
const SOURCES = [
  { n: 1, url: 'https://www.espncricinfo.com/final', title: 'India win the final by 6 runs', site: 'espncricinfo.com', snippet: 'Six runs.' },
  { n: 2, url: 'https://www.bbc.com/sport/cricket', title: 'Cricket final: as it happened', site: 'bbc.com', snippet: 'Live text.' },
];
const now = Date.now();
const iso = (ms: number) => new Date(now - ms).toISOString();
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

interface Server {
  posted: Array<Record<string, unknown>>;
  bulkDeleted: Array<Record<string, unknown>>;
  convs: Array<{ id: string; title: string; starred: boolean; activeLeafId: string | null; createdAt: string; updatedAt: string }>;
  reply: (body: Record<string, unknown>) => string;
}

async function setup(page: Page, opts: { theme?: 'dark' | 'light' } = {}): Promise<Server> {
  const server: Server = {
    posted: [],
    bulkDeleted: [],
    convs: [
      { id: C1, title: 'Raga Yaman', starred: false, activeLeafId: 'a1', createdAt: iso(60_000), updatedAt: iso(60_000) },
      { id: C2, title: 'Tabla practice plan', starred: true, activeLeafId: null, createdAt: iso(3 * 3_600_000), updatedAt: iso(3 * 3_600_000) },
      { id: C3, title: 'Carnatic ragas for beginners', starred: false, activeLeafId: null, createdAt: iso(2 * 86_400_000), updatedAt: iso(2 * 86_400_000) },
    ],
    reply: (body) => sse([
      ['meta', { conversationId: (body.conversationId as string) ?? C1, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), model: MODEL }],
      ['text', { delta: 'Yaman is an evening raga of the Kalyan thaat.\n\n| Raga | Time |\n|---|---|\n| Yaman | Evening |' }],
      ['done', { stopReason: 'end' }],
    ]),
  };
  await page.addInitScript(({ fp, theme }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark' });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    const p = url.pathname;
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/chat') {
      const body = req.postDataJSON() as Record<string, unknown>;
      server.posted.push(body);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: server.reply(body) });
    }
    if (p === '/api/ai/conversations') {
      if (req.method() === 'DELETE') {
        const body = req.postDataJSON() as { ids?: string[]; all?: boolean };
        server.bulkDeleted.push(body);
        const gone = body.all ? server.convs.map((c) => c.id) : body.ids ?? [];
        const before = server.convs.length;
        server.convs = server.convs.filter((c) => !gone.includes(c.id));
        return route.fulfill({ json: { ok: true, deleted: before - server.convs.length } });
      }
      const q = url.searchParams.get('q');
      return route.fulfill({ json: { items: server.convs.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase())), nextCursor: null } });
    }
    const m = /^\/api\/ai\/conversations\/([^/]+)$/.exec(p);
    if (m) {
      const c = server.convs.find((x) => x.id === m[1]);
      if (!c) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      return route.fulfill({ json: { conversation: c, messages: c.id === C1 ? [
        { id: 'u1', parentId: null, role: 'user', content: [{ type: 'text', text: 'What is raga Yaman?' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: iso(70_000) },
        { id: 'a1', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: 'Yaman is an evening raga of the Kalyan thaat. Its vadi is Ga.' }], thinking: null, thinkingMs: null, model: MODEL, stopReason: 'end', createdAt: iso(60_000) },
      ] : [] } });
    }
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

/** The shortcut modifier the page expects on this machine (shortcuts.ts isMac): ⌘ on a Mac, Ctrl on the Linux runner. */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const MOD_KEY = process.platform === 'darwin' ? '⌘' : 'Ctrl';

const composer = (page: Page) => page.getByRole('textbox', { name: /Message VinaX AI|What should VinaX AI research\?|Ask about the quoted part/ });

test('Research: switched on from the + menu, the request asks for it, the progress and sources show it ran several searches', async ({ page }) => {
  const server = await setup(page);
  server.reply = (body) => sse([
    ['meta', { conversationId: (body.conversationId as string) ?? C1, userMessageId: 'u9', assistantMessageId: 'a9', model: MODEL, research: true }],
    ['status', { step: 'planning' }],
    ['status', { step: 'researching', queries: ['who won the final', 'final scorecard', 'final highlights'], done: 0 }],
    ['status', { step: 'researching', queries: ['who won the final', 'final scorecard', 'final highlights'], done: 2 }],
    ['status', { step: 'searched', count: 2, sites: ['espncricinfo.com', 'bbc.com'] }],
    ['sources', { items: SOURCES, via: 'research', queries: ['who won the final', 'final scorecard', 'final highlights'] }],
    ['text', { delta: 'India won by six runs.[1]\n\n## How it went\n\nA tense last over.[2]' }],
    ['done', { stopReason: 'end' }],
  ]);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'More options' }).click();
  const item = page.getByRole('menuitemcheckbox', { name: /Research/ });
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  await expect(page.locator('.vx-ai-pill-research')).toContainText('Research');
  const box = page.getByRole('textbox', { name: 'What should VinaX AI research?' });
  await box.fill('Who won the final?');
  await box.press('Enter');
  await expect(page.locator('.vx-ai-md').getByText('India won by six runs.')).toBeVisible();
  expect(server.posted[0]).toMatchObject({ research: true, content: [{ type: 'text', text: 'Who won the final?' }] });
  const row = page.getByRole('region', { name: 'Sources' });
  await expect(row.getByRole('heading')).toHaveText('Research sources · 2');
  await expect(row).toContainText('Searched: who won the final · final scorecard · final highlights');
  await expect(row.getByRole('link')).toHaveCount(2);
  // The switch stays on for the next message, and goes off from its pill.
  await page.getByRole('button', { name: 'Turn off Research' }).click();
  await expect(page.locator('.vx-ai-pill-research')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
});

test('the welcome shows recent chats; the Chats page lists them all, and a selection is deleted in one request', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const recent = page.getByRole('region', { name: 'Your recent chats' });
  await expect(recent.getByRole('link', { name: /Raga Yaman/ })).toBeVisible();
  await expect(recent.getByRole('link', { name: /Tabla practice plan/ })).toContainText('3 h ago');
  await recent.getByRole('link', { name: 'All chats' }).click();
  await expect(page).toHaveURL(/\/vinaxai\/chats$/);
  const list = page.getByRole('list', { name: 'All chats' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search all chats' }).fill('raga');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select all chats' }).check();
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('2 selected');
  await page.getByRole('button', { name: 'Delete 2 chats' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete 2 chats?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => server.bulkDeleted).toEqual([{ ids: [C1, C3] }]);
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No chats match that' })).toBeVisible();
  // The sidebar has its own Chats entry.
  await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Chats', exact: true }).first()).toHaveAttribute('aria-current', 'page');
});

test('keyboard shortcuts: ⌘/ lists them, ⌘⇧O starts a new chat, ⌘⇧S hides the sidebar, Shift+Esc focuses the box', async ({ page }) => {
  await setup(page);
  await page.goto(`/vinaxai/c/${C1}`);
  await expect(page.locator('.vx-ai-md').getByText('Its vadi is Ga.')).toBeVisible();
  await page.keyboard.press(`${MOD}+/`);
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('New chat');
  await expect(dialog.locator('kbd').first()).toHaveText(MOD_KEY);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press(`${MOD}+Shift+S`);
  await expect(page.getByRole('navigation', { name: 'VinaX AI' })).toBeVisible();
  await page.keyboard.press(`${MOD}+Shift+S`);
  await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Escape');
  await expect(composer(page)).toBeFocused();
  await page.keyboard.press(`${MOD}+Shift+O`);
  await expect(page).toHaveURL(/\/vinaxai$/);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Tester/ })).toBeVisible();
});

test('"Ask about this": a selection in a reply becomes a quote above the composer and leads the next message', async ({ page }) => {
  const server = await setup(page);
  await page.goto(`/vinaxai/c/${C1}`);
  const p = page.locator('.vx-ai-turn-reply .vx-ai-md p').first();
  await expect(p).toContainText('Its vadi is Ga.');
  await p.evaluate((el) => {
    const text = el.firstChild as Text;
    const range = document.createRange();
    const at = text.data.indexOf('evening raga');
    range.setStart(text, at);
    range.setEnd(text, at + 'evening raga'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Ask about this' }).click();
  const quote = page.getByRole('group', { name: 'Quoted from the reply' });
  await expect(quote).toContainText('evening raga');
  const box = page.getByRole('textbox', { name: 'Ask about the quoted part' });
  await expect(box).toBeFocused();
  await box.fill('Why evening?');
  await box.press('Enter');
  await expect.poll(() => server.posted.length).toBe(1);
  expect(server.posted[0]).toMatchObject({ conversationId: C1, content: [{ type: 'text', text: '> evening raga\n\nWhy evening?' }] });
  await expect(quote).toHaveCount(0);
  await expect(page.locator('.vx-ai-bubble').last()).toContainText('> evening raga');
});

test('a table in a reply offers Copy as CSV', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await page.goto('/vinaxai');
  await composer(page).fill('Tell me about Yaman');
  await composer(page).press('Enter');
  const table = page.locator('.vx-ai-table-wrap');
  await expect(table.locator('td').first()).toHaveText('Yaman');
  await table.hover();
  await page.getByRole('button', { name: 'Copy table as CSV' }).click();
  await expect(page.getByText('Table copied as CSV')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Raga,Time\nYaman,Evening');
});

test('settings: a reply language goes with each message; Delete all chats empties the list', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  const panel = page.getByRole('dialog', { name: 'VinaX AI settings' });
  await panel.getByLabel('Reply language').selectOption('te');
  await expect(panel.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
  await panel.getByRole('button', { name: 'Close settings' }).click();
  await composer(page).fill('Namaskaram');
  await composer(page).press('Enter');
  await expect.poll(() => server.posted.length).toBe(1);
  expect(server.posted[0]).toMatchObject({ personal: { language: 'te' } });

  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  await panel.getByRole('button', { name: 'Delete all chats' }).click();
  await panel.getByRole('button', { name: 'Delete all my chats' }).click();
  await expect.poll(() => server.bulkDeleted).toEqual([{ all: true }]);
  await expect(page.getByText('3 chats deleted')).toBeVisible();
  await expect(page).toHaveURL(/\/vinaxai$/);
  await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText('Your chats will appear here.');
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations on the Chats page and the shortcuts dialog: ${theme}`, async ({ page }) => {
    await setup(page, { theme });
    await page.goto('/vinaxai/chats');
    await expect(page.getByRole('list', { name: 'All chats' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Raga Yaman' }).check();
    const chats = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(chats.violations).toEqual([]);
    await page.goto('/vinaxai');
    await expect(page.getByRole('region', { name: 'Your recent chats' })).toBeVisible();
    await page.keyboard.press(`${MOD}+/`);
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    const home = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(home.violations).toEqual([]);
  });
}
