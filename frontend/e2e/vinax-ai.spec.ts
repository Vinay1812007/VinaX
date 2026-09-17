import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * VinaX AI surface (/VinaXAI) against a mocked SSE backend: the welcome brief,
 * the slash-command menu and the local `/now` command, reply preferences
 * (now in the settings dialog) travelling in the request body, the streamed
 * reply with follow-up chips and per-reply actions (pin, branch), the single
 * model menu fed by the live catalogue, Agent mode with its activity list,
 * and saved prompts. No model, no network: `POST /api/vinaxai` is answered by
 * a canned event stream and `GET /api/aimodels` by a canned catalogue.
 */

interface ChatMessage {
  role: string;
  content: string;
}
interface ChatRequest {
  messages: ChatMessage[];
  mode?: string;
  model?: string;
}

const SSE_REPLY =
  'data: {"meta":{"model":"x","mode":"muse","web":"off","sources":[]}}\n\n' +
  'data: {"delta":"Here is a **short** answer.\\n\\n1. Kesariya — Arijit Singh\\n2. Srivalli — Sid Sriram\\n"}\n\n' +
  'data: {"delta":">>> Show an example | Make it shorter | Why?"}\n\n' +
  'data: {"done":true}\n\n';

/** An agentic reply: two tool runs reported as additive `step` frames. */
const SSE_AGENT_REPLY =
  'data: {"meta":{"model":"vendor/agentic","mode":"scholar","web":"off","sources":[]}}\n\n' +
  'data: {"step":{"tool":"search","label":"Searched the web for \u201cnews\u201d"}}\n\n' +
  'data: {"step":{"tool":"code","label":"Ran code"}}\n\n' +
  'data: {"delta":"Here is what I found."}\n\n' +
  'data: {"done":true}\n\n';

/** The live catalogue as GET /api/aimodels returns it (v7.1 adds `agent`). */
const CATALOG = {
  groups: [
    {
      id: 'grq',
      label: 'VinaX GRQ ALL',
      hint: 'Instant answers',
      configured: true,
      models: [
        { id: 'vendor/agentic', label: 'agentic', provider: 'grq', context: 131072, agent: true },
        { id: 'vendor/plain-8b', label: 'plain-8b', provider: 'grq', context: 8192, agent: false },
      ],
    },
    {
      id: 'opr',
      label: 'VinaX OPR ALL',
      hint: 'Marketplace',
      configured: true,
      models: [{ id: 'lab/big:free', label: 'big', provider: 'opr', context: 1000000, agent: false }],
    },
  ],
};

async function seed(page: Page): Promise<void> {
  await page.addInitScript((fp) => {
    localStorage.setItem(
      'vinax.settings.v1',
      JSON.stringify({ state: { theme: 'dark', accent: 'crimson', pinnedLanguages: ['telugu'] }, version: 2 }),
    );
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
}

/** Abort everything non-local; mock the AI stream; `{}` for other /api calls. */
async function mockNetwork(page: Page, posted: ChatRequest[]): Promise<void> {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/vinaxai' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as ChatRequest;
      posted.push(body);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: body.model === 'vendor/agentic' ? SSE_AGENT_REPLY : SSE_REPLY,
      });
    }
    if (url.pathname === '/api/aimodels') return route.fulfill({ json: CATALOG });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText);

/** DOM-level click on the first button whose label matches — some actions only
 *  surface on hover, so a pointer click would wait on visibility forever. */
async function clickButton(page: Page, pattern: RegExp): Promise<void> {
  const clicked = await page.evaluate(
    ([src, flags]) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (x) => re.test((x.textContent ?? '').trim()) || re.test(x.getAttribute('aria-label') ?? ''),
      );
      b?.click();
      return !!b;
    },
    [pattern.source, pattern.flags],
  );
  expect(clicked, `button matching ${pattern} exists`).toBe(true);
}

/** Open the latest reply's "More actions" menu (the toolbar is hover-revealed). */
async function openMoreActions(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const bs = document.querySelectorAll<HTMLButtonElement>('button[aria-label="More actions"]');
    const b = bs[bs.length - 1];
    b?.click();
    return !!b;
  });
  expect(ok, 'a "More actions" button exists').toBe(true);
}

/** v7.1 — chat settings is a modal dialog with tabs (it was a gear popover
 *  that toggled). Open it on a tab; close it with its own Close button. */
async function openSettings(page: Page, tab: string): Promise<void> {
  await page.locator('button[aria-label="Chat settings"]').click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: 'Chat settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
  await expect(dialog.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
}
async function closeSettings(page: Page): Promise<void> {
  await page.locator('button[aria-label="Close settings"]').click();
  await expect(page.locator('button[aria-label="Close settings"]')).toHaveCount(0);
}

test('welcome brief, slash commands, prefs in the request, reply actions, pin and branch', async ({ page }) => {
  const posted: ChatRequest[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page);
  await mockNetwork(page, posted);

  await page.goto('/VinaXAI', { waitUntil: 'domcontentloaded' });
  const box = page.locator('textarea[aria-label="Message VinaX AI"]');
  await expect(box).toBeVisible({ timeout: 15_000 });

  // Welcome brief + saved-prompts entry point.
  await expect.poll(() => bodyText(page), { timeout: 10_000 }).toMatch(/today for you/i);
  expect(await bodyText(page)).toMatch(/saved prompts/i);

  // Reply preferences live in the chat-settings DIALOG (v7.1; a gear popover
  // from v5.25.0 until then), on its Replies tab.
  await openSettings(page, 'Replies');
  await expect.poll(() => bodyText(page), { timeout: 5_000 }).toMatch(/reply in[\s\S]*style/i);
  await closeSettings(page);

  // Slash menu filters commands as you type.
  await box.fill('/pl');
  const menu = page.locator('[role="listbox"][aria-label="Commands"]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(/playlist/i);

  // `/now` is answered locally — nothing is playing in a fresh session.
  await box.fill('');
  await box.fill('/now');
  await box.press('Enter');
  await expect.poll(() => bodyText(page)).toMatch(/nothing is playing right now/i);
  expect(posted, '/now never reaches the backend').toHaveLength(0);

  // Reply preferences ride along as a rule in the first message.
  await openSettings(page, 'Replies');
  await page.selectOption('select[aria-label="Reply language"]', 'telugu');
  await page.selectOption('select[aria-label="Reply style"]', 'brief');
  await closeSettings(page);
  await box.fill('Give me two songs');
  await box.press('Enter');
  await expect.poll(() => bodyText(page), { timeout: 10_000 }).toMatch(/short answer/i);
  expect(posted).toHaveLength(1);
  const first = posted[0].messages[0].content;
  expect(first).toMatch(/reply in telugu/i);
  expect(first).toMatch(/at most three short sentences/i);

  // Follow-up chips are parsed out of the stream (the `>>>` marker never shows).
  const reply = await bodyText(page);
  expect(reply).toMatch(/show an example/i);
  expect(reply).toMatch(/make it shorter/i);
  expect(reply).not.toContain('>>>');
  // The song list in the reply becomes a playable card.
  expect(reply).toMatch(/save as playlist/i);

  // Per-reply actions: copy, read aloud, regenerate, thumbs, branch and pin sit
  // in the action row under the reply (v7.1 — pin and branch used to be inside
  // "More actions"); the rewrites stay in the "More actions" menu.
  const actions = page.locator('[role="group"][aria-label="Reply actions"]').last();
  for (const name of ['Copy', 'Regenerate', 'Good response', 'Bad response', 'Branch', 'Pin']) {
    await expect(actions.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  const moreMenu = page.locator('[role="menu"][aria-label="More actions"]');
  await openMoreActions(page);
  await expect(moreMenu).toBeVisible();
  for (const action of [/continue/i, /shorten/i, /expand/i, /simplify/i]) {
    await expect(moreMenu.locator('[role="menuitem"]').filter({ hasText: action })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await clickButton(page, /^pin$/i);
  await expect.poll(() => bodyText(page)).toMatch(/pinned/i);

  const messages = page.locator('[id^="ai-msg-"]');
  const before = await messages.count();
  await clickButton(page, /^show an example$/i);
  await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(2);
  const last = posted[1].messages[posted[1].messages.length - 1].content;
  expect(last).toMatch(/show an example/i);
  // Second exchange rendered and settled (thinking indicator gone, actions back).
  await expect.poll(() => messages.count(), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.locator('[role="status"][aria-label="Thinking"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('button[aria-label="More actions"]').last()).toBeAttached({ timeout: 10_000 });

  await clickButton(page, /^branch$/i);
  await expect.poll(() => bodyText(page)).toMatch(/· branch/i);

  expect(pageErrors).toEqual([]);
});

test('one model menu lists the live catalogue; a pick goes on the wire; Agent mode shows its working', async ({ page }) => {
  const posted: ChatRequest[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page);
  await mockNetwork(page, posted);

  await page.goto('/VinaXAI', { waitUntil: 'domcontentloaded' });
  const box = page.locator('textarea[aria-label="Message VinaX AI"]');
  await expect(box).toBeVisible({ timeout: 15_000 });

  // The greeting uses the listener's first name; the composer sits under it.
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Tester$/ })).toBeVisible();

  // Every pinned engine and every catalogue model, in one searchable listbox.
  await page.locator('button[aria-label^="Model:"]').click();
  const list = page.locator('[role="listbox"][aria-label="Choose model"]');
  await expect(list).toBeVisible();
  // Section headings are upper-cased by CSS and this harness reads RENDERED text, so match case-insensitively.
  for (const heading of [/recommended/i, /vinax engines/i, /vinax grq all/i, /vinax opr all/i]) {
    await expect(list).toContainText(heading);
  }
  const agentic = list.locator('[role="option"]').filter({ hasText: 'agentic' });
  await expect(agentic).toContainText(/agent/i);
  await expect(agentic).toContainText(/128k/i);
  await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);

  // Type to filter, Enter to choose: the chip names the catalogue model.
  const search = page.locator('input[aria-label="Search models"]');
  await search.fill('big');
  await expect(list.locator('[role="option"]')).toHaveCount(1);
  await search.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(page.locator('button[aria-label="Model: big"]')).toBeVisible();

  await box.fill('hello there');
  await box.press('Enter');
  await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
  expect(posted[0].mode).toBe('router');
  expect(posted[0].model).toBe('lab/big:free');
  await expect(page.locator('[role="status"][aria-label="Thinking"]')).toHaveCount(0, { timeout: 10_000 });

  // Agent mode moves to the agent-capable model and the reply shows its steps,
  // folded to one line once the answer is complete.
  const agent = page.locator('button[aria-label="Agent mode"]');
  await agent.click();
  await expect(agent).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[aria-label="Model: agentic"]')).toBeVisible();
  await box.fill('find the news');
  await box.press('Enter');
  await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(2);
  expect(posted[1].mode).toBe('scholar');
  expect(posted[1].model).toBe('vendor/agentic');
  const summary = page.getByRole('button', { name: /Searched the web · ran code · 2 steps/ });
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await summary.click();
  await expect(page.locator('ol[aria-label="Agent activity"] li')).toHaveCount(2);

  expect(pageErrors).toEqual([]);
});

test('saved prompts persist from the sheet', async ({ page }) => {
  const posted: ChatRequest[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page);
  await mockNetwork(page, posted);

  await page.goto('/VinaXAI', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('textarea[aria-label="Message VinaX AI"]')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => bodyText(page), { timeout: 10_000 }).toMatch(/saved prompts/i);

  await clickButton(page, /saved prompts$/i);
  const dialog = page.locator('[role="dialog"][aria-label="Saved prompts"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('Suggest 5 Telugu songs for driving');
  await dialog.getByRole('button', { name: /save prompt/i }).click();
  await expect(dialog).toContainText('Suggest 5 Telugu songs for driving');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vinax.aiPrompts') ?? '[]').length))
    .toBe(1);
  expect(pageErrors).toEqual([]);
});
