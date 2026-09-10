import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * VinaX AI surface (/VinaXAI) against a mocked SSE backend: the welcome brief,
 * the slash-command menu and the local `/now` command, reply preferences
 * travelling in the request body, the streamed reply with follow-up chips
 * and per-reply actions (pin, branch), and saved prompts. No model, no
 * network: `POST /api/vinaxai` is answered by a canned event stream.
 */

interface ChatMessage {
  role: string;
  content: string;
}
interface ChatRequest {
  messages: ChatMessage[];
}

const SSE_REPLY =
  'data: {"meta":{"model":"x","mode":"muse","web":"off","sources":[]}}\n\n' +
  'data: {"delta":"Here is a **short** answer.\\n\\n1. Kesariya — Arijit Singh\\n2. Srivalli — Sid Sriram\\n"}\n\n' +
  'data: {"delta":">>> Show an example | Make it shorter | Why?"}\n\n' +
  'data: {"done":true}\n\n';

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
      posted.push(JSON.parse(req.postData() || '{}') as ChatRequest);
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE_REPLY });
    }
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

  // Reply preferences moved OUT of a bar permanently parked above the composer
  // and INTO the chat-settings menu (v5.25.0). This assertion still checked the
  // old placement and had been failing ever since; it now opens the menu, which
  // is where a listener actually finds these controls today.
  const settings = page.locator('button[aria-label="Chat settings"]');
  await settings.click();
  await expect.poll(() => bodyText(page), { timeout: 5_000 }).toMatch(/reply in[\s\S]*style/i);
  await settings.click();

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

  // Reply preferences ride along as a rule in the first message. The controls
  // live in the chat-settings menu since v5.25.0, so open it to reach them.
  await settings.click();
  await page.selectOption('select[aria-label="Reply language"]', 'telugu');
  await page.selectOption('select[aria-label="Reply style"]', 'brief');
  await settings.click();
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

  // Per-reply actions live in the "More actions" menu.
  const moreMenu = page.locator('[role="menu"][aria-label="More actions"]');
  await openMoreActions(page);
  await expect(moreMenu).toBeVisible();
  for (const action of [/shorten/i, /expand/i, /simplify/i, /^pin$/i, /branch/i]) {
    await expect(moreMenu.locator('[role="menuitem"]').filter({ hasText: action })).toHaveCount(1);
  }
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

  await openMoreActions(page);
  await expect(moreMenu).toBeVisible();
  await clickButton(page, /^branch$/i);
  await expect.poll(() => bodyText(page)).toMatch(/· branch/i);

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
