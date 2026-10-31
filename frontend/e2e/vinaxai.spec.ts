/**
 * VinaX AI (/vinaxai) in a real browser, against the built app, with every
 * /api/ai/* call answered by the test: the sign-in gate, a reply streaming
 * in with its reasoning folded away, Stop, the old /VinaXAI address, and an
 * accessibility scan of a finished reply (prose and a code block).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const CONV = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODELS = { enabled: true, configured: true, groups: ['balanced'], models: [{ id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq', group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }] };

const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const REPLY = sse([
  ['meta', { conversationId: CONV, userMessageId: '11111111-1111-4111-8111-111111111111', assistantMessageId: '22222222-2222-4222-8222-222222222222', model: { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' } }],
  ['title', { title: 'Raga Yaman' }],
  ['thinking', { delta: 'The listener asks about Yaman, an evening raga.' }],
  ['text', { delta: 'Yaman is an **evening raga** of the Kalyan thaat.\n\n' }],
  ['text', { delta: '```python\nprint("Sa Re Ga")\n```\n' }],
  ['done', { stopReason: 'end', usage: { input: 10, output: 20 } }],
]);

async function setup(page: Page, chat: (route: Route) => Promise<void> | void = (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: REPLY })) {
  const posted: unknown[] = [];
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 2 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    // The festival calendar is switched off so its greeting never lands mid-test.
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (url.pathname === '/api/ai/chat') {
      posted.push(route.request().postDataJSON());
      return chat(route);
    }
    if (url.pathname === `/api/ai/conversations/${CONV}`) return route.fulfill({ json: { conversation: { id: CONV, title: 'Raga Yaman', starred: false, activeLeafId: null, createdAt: '', updatedAt: '' }, messages: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return posted;
}

test('signed out, /vinaxai shows the sign-in screen with a line about VinaX AI, not the chat', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX', level: 1 })).toBeVisible();
  await expect(page.getByText('chat with VinaX AI')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toHaveCount(0);
});

test('a reply streams in: reasoning folds to "Thought for", the model is named, the chat gets its address', async ({ page }) => {
  const posted = await setup(page);
  await page.goto('/vinaxai');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Tester/ })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('Tell me about raga Yaman');
  await box.press('Enter');
  await expect(page.locator('.vx-ai-md').getByText('Yaman is an')).toBeVisible();
  await expect(page.locator('.vx-ai-md strong')).toHaveText('evening raga');
  const fold = page.getByRole('button', { name: /Thought for \d+s/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(page.getByText('The listener asks about Yaman')).toBeVisible();
  await expect(page.getByText('GPT-OSS 120B · Groq')).toBeVisible();
  await expect(page.locator('.vx-ai-code-lang')).toHaveText('python');
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${CONV}$`));
  await expect(page.locator('.vx-ai-title')).toHaveText('Raga Yaman');
  expect(posted[0]).toMatchObject({ conversationId: null, mode: 'auto', content: [{ type: 'text', text: 'Tell me about raga Yaman' }] });
  await expect(box).toHaveValue('');
});

test('Stop ends a reply that has not started and gives the text back', async ({ page }) => {
  await setup(page, () => new Promise<void>(() => undefined)); // never answers
  await page.goto('/vinaxai');
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('A slow question');
  await page.getByRole('button', { name: 'Send message' }).click();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(box).toHaveValue('A slow question');
});

test('a refusal before the stream shows a calm notice and keeps the text', async ({ page }) => {
  await setup(page, (r) => r.fulfill({ status: 503, json: { error: 'ai_disabled' } }));
  await page.goto('/vinaxai');
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('Hello');
  await box.press('Enter');
  await expect(page.getByRole('alert')).toContainText('VinaX AI is taking a break');
  await expect(box).toHaveValue('Hello');
});

test('the old /VinaXAI address lands on /vinaxai', async ({ page }) => {
  await setup(page);
  await page.goto('/VinaXAI');
  await expect(page).toHaveURL(/\/vinaxai$/);
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`a finished reply has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await setup(page);
    // Runs after setup's script (init scripts run in the order they were added).
    await page.addInitScript((t) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: t, pinnedLanguages: ['telugu'] }, version: 2 }));
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai');
    const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
    await box.fill('Tell me about raga Yaman');
    await box.press('Enter');
    await expect(page.getByText('GPT-OSS 120B · Groq')).toBeVisible();
    await page.waitForTimeout(300); // the highlighter chunk
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
}
