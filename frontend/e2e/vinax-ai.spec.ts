import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * VinaX AI surface (/VinaXAI) against a mocked SSE backend: the welcome brief,
 * the slash-command menu and the local `/now` command, reply preferences
 * (now in the settings dialog) travelling in the request body, the streamed
 * reply with follow-up chips and per-reply actions (pin, branch), the single
 * model menu fed by the live catalogue, the Connectors in the + menu, and
 * saved prompts. No model, no network: `POST /api/vinaxai` is answered by
 * a canned event stream and `GET /api/aimodels` by a canned catalogue.
 */

interface ChatMessage {
  role: string;
  content: string;
}
interface ChatRequest {
  messages: ChatMessage[];
  mode?: string;
  provider?: string;
  model?: string;
}

const SSE_REPLY =
  'data: {"meta":{"model":"Alpha 70B","modelId":"lab/alpha-70b","provider":"nvidia","mode":"auto"}}\n\n' +
  'data: {"delta":"Here is a **short** answer.\\n\\n1. Kesariya — Arijit Singh\\n2. Srivalli — Sid Sriram\\n"}\n\n' +
  'data: {"delta":">>> Show an example | Make it shorter | Why?"}\n\n' +
  'data: {"done":true}\n\n';

/** The live list as GET /api/aimodels returns it (10.3): four providers, in order. */
const CATALOG = {
  fetchedAt: '2026-10-06T00:00:00.000Z',
  providers: [
    {
      id: 'nvidia',
      label: 'NVIDIA',
      configured: true,
      models: [
        { id: 'lab/alpha-70b', name: 'Alpha 70B', maker: 'Lab One', context: 131072, vision: false },
        { id: 'lab/alpha-11b-vision', name: 'Alpha 11B Vision', maker: 'Lab One', context: 8192, vision: true },
      ],
    },
    { id: 'openrouter', label: 'OpenRouter', configured: true, models: [{ id: 'maker/big:free', name: 'Big Model', maker: 'Maker Two', context: 1000000, vision: false }] },
    { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }] },
    { id: 'gemini', label: 'Gemini', configured: false, models: [] },
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
        body: SSE_REPLY,
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

test('one model menu lists the live catalogue; a pick goes on the wire; connectors switch on and off', async ({ page }) => {
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

  // 10.3 — Auto, then one section per provider (logo + name), every model
  // under its original name, in one searchable listbox.
  await page.locator('button[aria-label^="Model:"]').click();
  const list = page.locator('[role="listbox"][aria-label="Choose model"]');
  await expect(list).toBeVisible();
  // This harness reads RENDERED text, so match headings case-insensitively.
  for (const heading of [/nvidia/i, /openrouter/i, /groq/i, /gemini/i]) {
    await expect(list).toContainText(heading);
  }
  await expect(list.locator('.ai-model-heading svg[data-provider]')).toHaveCount(4);
  await expect(list).toContainText(/not available right now/i);
  const alpha = list.locator('[role="option"]').filter({ hasText: 'Alpha 70B' });
  await expect(alpha).toContainText(/128k context/i);
  await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await expect(list.locator('[role="option"][aria-selected="true"]')).toContainText('Auto');
  // Phone width: the menu never scrolls the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Type to filter, Enter to choose: the chip shows the provider's logo and the model's name.
  const search = page.locator('input[aria-label="Search models"]');
  await search.fill('maker two');
  await expect(list.locator('[role="option"]')).toHaveCount(1);
  await search.press('Enter');
  await expect(list).toHaveCount(0);
  const trigger = page.locator('button[aria-label="Model: Big Model"]');
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('svg[data-provider="openrouter"]')).toHaveCount(1);

  await box.fill('hello there');
  await box.press('Enter');
  await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
  expect(posted[0].mode).toBe('model');
  expect(posted[0].provider).toBe('openrouter');
  expect(posted[0].model).toBe('maker/big:free');
  // Who answered: the provider's logo and the model's original name, from meta.
  const answered = page.locator('.ai-engine-chip').last();
  await expect(answered).toHaveText('Alpha 70B');
  await expect(answered.locator('svg[data-provider="nvidia"]')).toHaveCount(1);
  await expect(page.locator('[role="status"][aria-label="Thinking"]')).toHaveCount(0, { timeout: 10_000 });

  // 10.2 — no Agent mode.
  await expect(page.locator('button[aria-label="Agent mode"]')).toHaveCount(0);

  // 10.0 — Connectors: switches in the + menu, active ones as chips above the box.
  await page.locator('button[aria-label="Attach and tools"]').click();
  // The group is named by its heading (aria-labelledby), so find it by role + name.
  const group = page.getByRole('group', { name: 'Connectors', exact: true });
  await expect(group.getByRole('switch')).toHaveCount(4);
  expect((await group.locator('.ai-conn-name').allTextContents()).map((t) => t.trim())).toEqual(['Think', 'Now playing', 'Memory', 'Place']);
  const think = page.getByRole('switch', { name: 'Think' });
  await expect(think).toHaveAttribute('aria-checked', 'false');
  await think.click();
  await expect(think).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  const chip = page.locator('[role="group"][aria-label="Active connectors"] button[aria-label="Turn off Think"]');
  await expect(chip).toBeVisible();
  await box.fill('explain this carefully');
  await box.press('Enter');
  await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(2);
  // 10.3 — Think never overrides an exact pick, and the body carries no retired fields.
  expect(posted[1]).toMatchObject({ mode: 'model', provider: 'openrouter', model: 'maker/big:free' });
  expect(posted[1]).not.toHaveProperty('web');
  await chip.click();
  await expect(chip).toHaveCount(0);

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
