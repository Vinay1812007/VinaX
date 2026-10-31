/**
 * VinaX AI artifacts (phase 5) in a real browser. The sandbox site is the
 * real sandbox/index.html with its real headers, served at
 * https://sandbox.vinaxmusic.online/ by the test; everything else off
 * localhost is blocked, so the CDN-backed previews (React, Mermaid) show the
 * runner's load error instead, which proves the error path. HTML and SVG
 * previews run for real, in the sandboxed, cross-origin frame.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const SANDBOX = 'https://sandbox.vinaxmusic.online';
const RUNNER = readFileSync(new URL('../../sandbox/index.html', import.meta.url), 'utf8');
const RUNNER_CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../../sandbox/_headers', import.meta.url), 'utf8'))![1];
const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const answer = (text: string, n = 1) => sse([
  ['meta', { conversationId: C1, userMessageId: `u${n}`, assistantMessageId: `a${n}`, model: MODEL }],
  ['text', { delta: text }],
  ['done', { stopReason: 'end' }],
]);

async function setup(page: Page, replies: string[], opts: { sandbox?: boolean } = {}) {
  let i = 0;
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === SANDBOX) {
      if (opts.sandbox === false) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': RUNNER_CSP }, body: RUNNER });
    }
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: { enabled: true, configured: true, groups: ['balanced'], models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }] } });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/chat') {
      i += 1;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: answer(replies[Math.min(i, replies.length) - 1], i) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const ask = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill(text);
  await box.press('Enter');
};

const PAGE_V1 = 'Here is your page.\n<artifact id="hello-page" type="html" title="Hello page">\n<!doctype html><h1 id="t">Hello from the sandbox</h1><script>var t = document.getElementById("t"); try { t.dataset.top = String(window.top.document.title); } catch (e) { t.dataset.top = "blocked"; } try { t.dataset.store = String(window.localStorage.length); } catch (e) { t.dataset.store = "blocked"; }</script>\n</artifact>\nOpen it to see it.';
const PAGE_V2 = 'Updated.\n<artifact id="hello-page" type="html" title="Hello page">\n<h1>Version two</h1>\n</artifact>';

test('an HTML artifact: the card opens the panel, and Preview runs it in the cross-origin sandbox', async ({ page }) => {
  await setup(page, [PAGE_V1]);
  await page.goto('/vinaxai');
  await ask(page, 'Make me a page');
  await expect(page.locator('.vx-ai-md').first()).toContainText('Here is your page.');
  await expect(page.locator('.vx-ai-md').last()).toContainText('Open it to see it.');
  const panel = page.getByRole('complementary', { name: 'Artifact: Hello page' });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: /^Hello page/ }).last().click();
  await panel.getByRole('tab', { name: 'Preview' }).click();
  const runner = page.frameLocator('iframe[title="Preview: Hello page"]');
  await expect(runner.frameLocator('iframe').locator('h1')).toHaveText('Hello from the sandbox');
  // The artifact's own script cannot reach the app's page or any storage.
  await expect(runner.frameLocator('iframe').locator('h1')).toHaveAttribute('data-top', 'blocked');
  await expect(runner.frameLocator('iframe').locator('h1')).toHaveAttribute('data-store', 'blocked');
  expect(await page.locator('iframe[title="Preview: Hello page"]').getAttribute('sandbox')).toBe('allow-scripts allow-modals');
  await panel.getByRole('tab', { name: 'Code' }).click();
  await expect(panel.locator('pre')).toContainText('Hello from the sandbox');
});

test('an updated artifact is a new version: "v2 of 2", and the old one is a step back', async ({ page }) => {
  await setup(page, [PAGE_V1, PAGE_V2]);
  await page.goto('/vinaxai');
  await ask(page, 'Make me a page');
  await expect(page.getByRole('button', { name: /^Hello page/ }).last()).toBeVisible();
  await ask(page, 'Make it say version two');
  await expect(page.getByRole('button', { name: /^Hello page.*v2/ })).toBeVisible();
  await page.getByRole('button', { name: /^Hello page.*v2/ }).click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Hello page' });
  await expect(panel.getByText('v2 of 2')).toBeVisible();
  await panel.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.frameLocator('iframe[title="Preview: Hello page"]').frameLocator('iframe').locator('h1')).toHaveText('Version two');
  await panel.getByRole('button', { name: 'Previous version' }).click();
  await expect(panel.getByText('v1 of 2')).toBeVisible();
  await expect(page.frameLocator('iframe[title="Preview: Hello page"]').frameLocator('iframe').locator('h1')).toHaveText('Hello from the sandbox');
});

test('an SVG artifact previews as an image; a React one shows the runner’s error when its libraries cannot load', async ({ page }) => {
  await setup(page, [
    'A logo: <artifact id="logo" type="svg" title="Logo"><svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="30" fill="tomato"/></svg></artifact>',
    'A counter: <artifact id="counter" type="react" title="Counter">export default function Counter() { return <button>0</button>; }</artifact>',
  ]);
  await page.goto('/vinaxai');
  await ask(page, 'Draw a logo');
  await page.getByRole('button', { name: /^Logo/ }).click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Logo' });
  await panel.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.frameLocator('iframe[title="Preview: Logo"]').getByRole('img', { name: 'SVG preview' })).toBeVisible();
  await ask(page, 'Now a counter');
  await page.getByRole('button', { name: /^Counter/ }).click();
  const react = page.getByRole('complementary', { name: 'Artifact: Counter' });
  await react.getByRole('tab', { name: 'Preview' }).click();
  await expect(react.getByRole('alert')).toContainText('Could not load react/18.3.1/umd');
});

test('without the sandbox site, Preview says so and Code, Copy and Download still work', async ({ page }) => {
  await setup(page, [PAGE_V1], { sandbox: false });
  await page.goto('/vinaxai');
  await ask(page, 'Make me a page');
  await page.getByRole('button', { name: /^Hello page/ }).last().click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Hello page' });
  await panel.getByRole('tab', { name: 'Preview' }).click();
  await expect(panel.getByText('Preview needs the sandbox host.')).toBeVisible({ timeout: 12_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download artifact' }).click()]);
  expect(file.suggestedFilename()).toBe('hello-page.html');
  await panel.getByRole('tab', { name: 'Code' }).click();
  await expect(panel.locator('pre')).toContainText('<h1 id="t">');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the panel is a full-screen sheet that closes back to the chat', async ({ page }) => {
    await setup(page, [PAGE_V1]);
    await page.goto('/vinaxai');
    await ask(page, 'Make me a page');
    await page.getByRole('button', { name: /^Hello page/ }).last().click();
    const sheet = page.getByRole('dialog', { name: 'Artifact: Hello page' });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBe(390);
    await sheet.getByRole('button', { name: 'Close the artifact' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
  });
});

for (const theme of ['dark', 'light'] as const) {
  test(`a reply with an artifact and its panel have no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await setup(page, [PAGE_V1]);
    await page.addInitScript((t) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: t, pinnedLanguages: ['telugu'] }, version: 5 }));
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai');
    await ask(page, 'Make me a page');
    await page.getByRole('button', { name: /^Hello page/ }).last().click();
    const panel = page.getByRole('complementary', { name: 'Artifact: Hello page' });
    await panel.getByRole('tab', { name: 'Code' }).click();
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('iframe[title^="Preview"]').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
}
