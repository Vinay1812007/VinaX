/**
 * VinaX AI artifacts gallery (/vinaxai/artifacts) in a real browser against
 * the built app, with /api/ai/* answered by a small in-test server: the
 * sidebar and settings links, cards newest first, kind chips, title search,
 * more cards on scroll, a card in the panel (Preview in the real sandbox
 * runner, served here like e2e/vinaxai-artifacts.spec.ts does; Code;
 * versions; Download), Open chat landing on that reply (on its own branch),
 * the phone sheet, and accessibility scans in dark and light.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const SANDBOX = 'https://sandbox.vinaxmusic.online';
const RUNNER = readFileSync(new URL('../../sandbox/index.html', import.meta.url), 'utf8');
const RUNNER_CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../../sandbox/_headers', import.meta.url), 'utf8'))![1];
const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const C2 = '7d0e4b1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const MODEL = { id: 'test:model-a', name: 'Model A', provider: 'Test' };
const MODELS = {
  enabled: true, configured: true, groups: ['balanced'],
  models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }],
};
const now = new Date().toISOString();

const PAGE_V1 = '<h1>Hello from the gallery</h1>';
const PAGE_V2 = '<h1>Version two</h1>';
const SORT = 'def quick_sort(xs):\n    return sorted(xs)';
const FLOW = 'graph TD; A-->B';
const text = (intro: string, a: { id: string; type: string; title: string; language?: string; content: string }) =>
  `${intro}\n<artifact id="${a.id}" type="${a.type}" title="${a.title}"${a.language ? ` language="${a.language}"` : ''}>\n${a.content}\n</artifact>`;

// The chat C1: u1 → a1 (page v1) → u2 → a2 (page v2, the active leaf), and a
// retry of the first answer, a1b, on its own branch (the diagram).
const msg = (id: string, parentId: string | null, role: 'user' | 'assistant', body: string, at: string) => ({
  id, parentId, role, content: [{ type: 'text', text: body }], thinking: null, thinkingMs: null, model: role === 'assistant' ? MODEL : null, stopReason: role === 'assistant' ? 'end' : null, createdAt: at,
});
const TREE = {
  conversation: { id: C1, title: 'Website', starred: false, activeLeafId: 'a2', createdAt: now, updatedAt: now },
  messages: [
    msg('u1', null, 'user', 'Make me a landing page', '2026-11-01T10:00:00Z'),
    msg('a1', 'u1', 'assistant', text('Here it is.', { id: 'landing', type: 'html', title: 'Landing page', content: PAGE_V1 }), '2026-11-01T10:00:01Z'),
    msg('a1b', 'u1', 'assistant', text('Here is the flow instead.', { id: 'flow', type: 'mermaid', title: 'Login flow', content: FLOW }), '2026-11-01T10:00:02Z'),
    msg('u2', 'a1', 'user', 'Make it say version two', '2026-11-01T10:01:00Z'),
    msg('a2', 'u2', 'assistant', text('Updated.', { id: 'landing', type: 'html', title: 'Landing page', content: PAGE_V2 }), '2026-11-01T10:01:01Z'),
  ],
};

interface Item { conversationId: string; conversationTitle: string | null; artifactId: string; messageId: string; kind: string; title: string; language: string | null; incomplete: boolean; versions: number; createdAt: string }
const ITEMS: Item[] = [
  { conversationId: C1, conversationTitle: 'Website', artifactId: 'landing', messageId: 'a2', kind: 'html', title: 'Landing page', language: null, incomplete: false, versions: 2, createdAt: '2026-11-01T10:01:01Z' },
  { conversationId: C2, conversationTitle: 'Sorting things', artifactId: 'sort', messageId: 'b1', kind: 'code', title: 'Quick sort', language: 'python', incomplete: false, versions: 1, createdAt: '2026-11-01T09:30:00Z' },
  { conversationId: C1, conversationTitle: 'Website', artifactId: 'flow', messageId: 'a1b', kind: 'mermaid', title: 'Login flow', language: null, incomplete: false, versions: 1, createdAt: '2026-11-01T10:00:02Z' },
];
const VERSIONS: Record<string, unknown> = {
  [`${C1}/landing`]: { conversationId: C1, conversationTitle: 'Website', artifactId: 'landing', versions: [
    { messageId: 'a1', createdAt: '2026-11-01T10:00:01Z', type: 'html', title: 'Landing page', language: null, content: PAGE_V1, incomplete: false },
    { messageId: 'a2', createdAt: '2026-11-01T10:01:01Z', type: 'html', title: 'Landing page', language: null, content: PAGE_V2, incomplete: false },
  ] },
  [`${C2}/sort`]: { conversationId: C2, conversationTitle: 'Sorting things', artifactId: 'sort', versions: [
    { messageId: 'b1', createdAt: '2026-11-01T09:30:00Z', type: 'code', title: 'Quick sort', language: 'python', content: SORT, incomplete: false },
  ] },
  [`${C1}/flow`]: { conversationId: C1, conversationTitle: 'Website', artifactId: 'flow', versions: [
    { messageId: 'a1b', createdAt: '2026-11-01T10:00:02Z', type: 'mermaid', title: 'Login flow', language: null, content: FLOW, incomplete: false },
  ] },
};

interface Server { lists: URLSearchParams[] }

async function setup(page: Page, opts: { theme?: 'dark' | 'light'; many?: number } = {}): Promise<Server> {
  const server: Server = { lists: [] };
  // Many cards: older code artifacts after the three above, for paging.
  const extra: Item[] = Array.from({ length: opts.many ?? 0 }, (_, i) => ({
    conversationId: C2, conversationTitle: 'Sorting things', artifactId: `snippet-${i}`, messageId: 'b1', kind: 'code', title: `Snippet ${i + 1}`, language: 'js', incomplete: false, versions: 1,
    createdAt: new Date(Date.parse('2026-10-20T10:00:00Z') - i * 60_000).toISOString(),
  }));
  const all = [...ITEMS].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).concat(extra);
  await page.addInitScript(({ fp, theme }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark' });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === SANDBOX) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': RUNNER_CSP }, body: RUNNER });
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    const p = url.pathname;
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/conversations') return route.fulfill({ json: { items: [TREE.conversation], nextCursor: null } });
    if (p === `/api/ai/conversations/${C1}`) return route.fulfill({ json: req.method() === 'GET' ? TREE : { conversation: TREE.conversation } });
    if (p === '/api/ai/artifacts') {
      server.lists.push(url.searchParams);
      const kind = url.searchParams.get('kind');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const hits = all.filter((i) => (!kind || i.kind === kind) && (!q || i.title.toLowerCase().includes(q)));
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const page = hits.slice(start, start + 30);
      return route.fulfill({ json: { items: page, nextCursor: start + 30 < hits.length ? String(start + 30) : null } });
    }
    if (p.startsWith('/api/ai/artifacts/')) {
      const key = decodeURIComponent(p.slice('/api/ai/artifacts/'.length));
      return VERSIONS[key] ? route.fulfill({ json: { artifact: VERSIONS[key] } }) : route.fulfill({ status: 404, json: { error: 'not_found' } });
    }
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const cards = (page: Page) => page.getByRole('list', { name: 'Artifacts' }).getByRole('button');

test('the sidebar opens the gallery: cards newest first, by kind, by title', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('link', { name: 'Artifacts', exact: true }).click();
  await expect(page).toHaveURL(/\/vinaxai\/artifacts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Artifacts' })).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toContainText('Landing page');
  await expect(cards(page).nth(0)).toContainText('HTML page · 2 versions');
  await expect(cards(page).nth(1)).toContainText('Login flow');
  await expect(cards(page).nth(2)).toContainText('Code · Python');
  await expect(cards(page).nth(2)).toContainText('Sorting things');
  // The sidebar marks where you are.
  await expect(page.getByRole('link', { name: 'Artifacts', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Diagrams', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Login flow');
  await expect(page.getByRole('button', { name: 'Diagrams', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search artifacts' }).fill('sort');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Quick sort');
  await page.getByRole('searchbox', { name: 'Search artifacts' }).fill('nothing like it');
  await expect(page.getByText('No artifacts match that.')).toBeVisible();
  expect(server.lists.some((s) => s.get('kind') === 'mermaid')).toBe(true);
  expect(server.lists.some((s) => s.get('q') === 'sort')).toBe(true);
});

test('more cards load as the list scrolls', async ({ page }) => {
  await setup(page, { many: 40 });
  await page.goto('/vinaxai/artifacts');
  await expect(cards(page)).toHaveCount(30);
  await cards(page).last().scrollIntoViewIfNeeded();
  await expect(cards(page)).toHaveCount(43);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('a card opens in the panel: Preview runs in the sandbox, versions step back, Code and Download work', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai/artifacts');
  await cards(page).filter({ hasText: 'Landing page' }).click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Landing page' });
  await expect(panel.getByText('v2 of 2')).toBeVisible();
  const runner = page.frameLocator('iframe[title="Preview: Landing page"]').frameLocator('iframe');
  await expect(runner.locator('h1')).toHaveText('Version two');
  expect(await page.locator('iframe[title="Preview: Landing page"]').getAttribute('sandbox')).toBe('allow-scripts allow-modals');
  await panel.getByRole('button', { name: 'Previous version' }).click();
  await expect(panel.getByText('v1 of 2')).toBeVisible();
  await expect(runner.locator('h1')).toHaveText('Hello from the gallery');
  await panel.getByRole('tab', { name: 'Code' }).click();
  await expect(panel.locator('pre')).toContainText('Hello from the gallery');
  const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download artifact' }).click()]);
  expect(file.suggestedFilename()).toBe('landing-page.html');
  await panel.getByRole('button', { name: 'Close the artifact' }).click();
  await expect(panel).toHaveCount(0);

  await cards(page).filter({ hasText: 'Quick sort' }).click();
  const code = page.getByRole('complementary', { name: 'Artifact: Quick sort' });
  await expect(code.locator('pre')).toContainText('def quick_sort');
  await expect(code.getByRole('tab')).toHaveCount(0);
});

test('Open chat lands on the reply that made that version, with the artifact open', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai/artifacts');
  await cards(page).filter({ hasText: 'Landing page' }).click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Landing page' });
  await panel.getByRole('button', { name: 'Previous version' }).click();
  await panel.getByRole('button', { name: 'Open chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C1}$`));
  const chatPanel = page.getByRole('complementary', { name: 'Artifact: Landing page' });
  await expect(chatPanel.getByText('v1 of 2')).toBeVisible();
  await expect(chatPanel.getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  await expect(page.getByText('Here it is.')).toBeInViewport();
});

test('Open chat on a reply from another branch switches to that branch', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai/artifacts');
  await cards(page).filter({ hasText: 'Login flow' }).click();
  await page.getByRole('complementary', { name: 'Artifact: Login flow' }).getByRole('button', { name: 'Open chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C1}$`));
  await expect(page.getByText('Here is the flow instead.')).toBeVisible();
  await expect(page.getByText('Updated.')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Artifact: Login flow' })).toBeVisible();
});

test('VinaX AI settings → Your chats links to the gallery', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  const settings = page.getByRole('dialog', { name: 'VinaX AI settings' });
  await settings.getByRole('link', { name: 'Your artifacts' }).click();
  await expect(page).toHaveURL(/\/vinaxai\/artifacts$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the gallery fits; a card opens as a full-screen sheet that Escape closes, back to the card', async ({ page }) => {
    await setup(page);
    await page.goto('/vinaxai/artifacts');
    await expect(cards(page)).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Back to chats' })).toHaveAttribute('href', '/vinaxai');
    const card = cards(page).filter({ hasText: 'Quick sort' });
    await card.click();
    const sheet = page.getByRole('dialog', { name: 'Artifact: Quick sort' });
    await expect(sheet.locator('pre')).toContainText('def quick_sort');
    expect((await sheet.boundingBox())?.width).toBe(390);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(card).toBeFocused();
  });
});

for (const theme of ['dark', 'light'] as const) {
  test(`the gallery and its panel have no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await setup(page, { theme });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai/artifacts');
    await expect(cards(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await page.waitForTimeout(300);
    const scan = async () => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('iframe[title^="Preview"]').analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    };
    await scan();
    await cards(page).first().click();
    await expect(page.getByRole('complementary', { name: 'Artifact: Quick sort' }).locator('pre')).toContainText('def quick_sort');
    await scan();
  });
}
