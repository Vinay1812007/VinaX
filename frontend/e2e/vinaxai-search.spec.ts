/**
 * VinaX AI web search (phase 3) in a real browser, with /api/ai/* answered by
 * the test: the search API path (sources before the text, [n] chips), the
 * grounding path (markers placed after the text, Google's suggestions in a
 * sandboxed frame), the + menu's Web search choice, and an accessibility
 * scan with a source shown.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const SOURCES = [
  { n: 1, url: 'https://www.espncricinfo.com/final', title: 'India win the final by 6 runs', site: 'espncricinfo.com', snippet: 'India beat Australia by six runs in a tense final.' },
  { n: 2, url: 'https://www.bbc.com/sport/cricket', title: 'Cricket final: as it happened', site: 'bbc.com', snippet: 'Live text from the final.' },
];
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

async function setup(page: Page, reply: string): Promise<Array<Record<string, unknown>>> {
  const posted: Array<Record<string, unknown>> = [];
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: { enabled: true, configured: true, search: true, groups: ['balanced'], models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }] } });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/chat') {
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: reply });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return posted;
}

const ask = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill(text);
  await box.press('Enter');
};

test('search API: [n] chips open the sources, hovering shows one, and the Sources row lists them', async ({ page }) => {
  await setup(page, sse([
    ['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }],
    ['status', { step: 'searching', query: 'who won the final today' }],
    ['status', { step: 'searched', count: 2, sites: ['espncricinfo.com', 'bbc.com'] }],
    ['sources', { items: SOURCES, via: 'search' }],
    ['text', { delta: 'India won the final by six runs.[1][2] The ' }],
    ['text', { delta: 'trophy was presented in Ahmedabad.[1]' }],
    ['done', { stopReason: 'end' }],
  ]));
  await page.goto('/vinaxai');
  await ask(page, 'Who won the final today?');
  const chips = page.locator('.vx-ai-md a.vx-ai-cite');
  await expect(chips).toHaveCount(3);
  await expect(chips.first()).toHaveAttribute('href', SOURCES[0].url);
  await expect(chips.first()).toHaveAttribute('target', '_blank');
  await chips.nth(1).hover();
  await expect(page.getByRole('tooltip')).toContainText('Cricket final: as it happened');
  const row = page.getByRole('region', { name: 'Sources' });
  await expect(row.getByRole('link')).toHaveCount(2);
  await expect(row).toContainText('India win the final by 6 runs');
});

test('grounding: markers are placed after the text arrives, and Google’s suggestions show in a sandboxed frame', async ({ page }) => {
  await setup(page, sse([
    ['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'gemini:gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google Gemini' } }],
    ['status', { step: 'searching', query: 'who won the final' }],
    ['text', { delta: 'India won the final by six runs. The next match is on Sunday.' }],
    ['status', { step: 'searched', count: 2, sites: ['espncricinfo.com', 'bbc.com'] }],
    ['sources', { items: SOURCES, via: 'grounding', queries: ['india final'], entryPointHtml: '<style>.chip{display:inline-block;padding:4px 10px;border:1px solid #888;border-radius:16px;color:#ddd;font:13px sans-serif}</style><a class="chip" href="https://www.google.com/search?q=india+final">india final</a>', markers: [{ at: 32, ns: [1, 2] }, { at: 61, ns: [2] }] }],
    ['done', { stopReason: 'end' }],
  ]));
  await page.goto('/vinaxai');
  await ask(page, 'Who won the final?');
  await expect(page.locator('.vx-ai-md a.vx-ai-cite')).toHaveCount(3);
  await expect(page.locator('.vx-ai-md p')).toHaveText('India won the final by six runs.12 The next match is on Sunday.2');
  const frame = page.locator('iframe.vx-ai-gsearch');
  await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  await expect(page.frameLocator('iframe.vx-ai-gsearch').locator('a.chip')).toHaveText('india final');
});

test('the + menu sets Web search, and every message carries it', async ({ page }) => {
  const posted = await setup(page, sse([['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }], ['text', { delta: 'ok' }], ['done', { stopReason: 'end' }]]));
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitemradio', { name: /^On/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.vx-ai-pill', { hasText: 'Web search' })).toBeVisible();
  await ask(page, 'Explain recursion');
  await expect(page.locator('.vx-ai-md')).toContainText('ok');
  expect(posted[0]).toMatchObject({ webSearch: 'on' });
});

for (const theme of ['dark', 'light'] as const) {
  test(`a reply with sources has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await setup(page, sse([
      ['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }],
      ['sources', { items: SOURCES, via: 'search' }],
      ['text', { delta: 'India won the final.[1][2]' }],
      ['done', { stopReason: 'end' }],
    ]));
    await page.addInitScript((t) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: t, pinnedLanguages: ['telugu'] }, version: 5 }));
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai');
    await ask(page, 'Who won the final today?');
    await expect(page.getByRole('region', { name: 'Sources' })).toBeVisible();
    await page.locator('.vx-ai-md a.vx-ai-cite').first().focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
}
