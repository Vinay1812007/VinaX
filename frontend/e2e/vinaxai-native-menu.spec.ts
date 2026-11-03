/**
 * VinaX AI keeps the browser's own right-click menu and text selection (to
 * copy replies, links and code); the rest of the app keeps its own menu.
 * Runs on the production build, where the cosmetic deterrence is on.
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

async function setup(page: Page): Promise<void> {
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
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: { enabled: true, configured: true, groups: ['balanced'], models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }] } });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/chat') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([['meta', { conversationId: '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10', userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), model: MODEL }], ['text', { delta: 'Raga Yaman is an evening raga.' }], ['done', { stopReason: 'end' }]]) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

/** Right-click `selector` and report whether anything blocked the browser's menu. */
const rightClickBlocked = (page: Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel)!;
  const r = el.getBoundingClientRect();
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 5, clientY: r.top + 5 });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}, selector);

test('in VinaX AI a right-click opens the browser’s menu and replies can be selected', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('What is Yaman?');
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).press('Enter');
  await expect(page.locator('.vx-ai-turn-reply').getByText('Raga Yaman is an evening raga.')).toBeVisible();
  expect(await rightClickBlocked(page, '.vx-ai-turn-reply')).toBe(false);
  await expect(page.getByRole('menu', { name: 'App actions' })).toHaveCount(0);
  const select = await page.locator('.vx-ai-turn-reply p').first().evaluate((el) => getComputedStyle(el).userSelect);
  expect(select).not.toBe('none');
});

test('elsewhere the app keeps its own right-click menu', async ({ page }) => {
  await setup(page);
  await page.goto('/library');
  await page.locator('main').click({ button: 'right', position: { x: 40, y: 40 } });
  await expect(page.getByRole('menu', { name: 'App actions' })).toBeVisible();
});
