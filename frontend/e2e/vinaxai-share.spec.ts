/**
 * VinaX AI sharing, in a real browser against the built app, with /api/ai/*
 * answered by a small in-test server: the Share chat dialog (create, copy,
 * update, stop), the read-only page a link opens (signed out, artifacts in
 * the panel, no composer), Continue this chat, the Shared links list in
 * settings, and accessibility scans of the dialog and the page.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const C9 = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SID = 'Qm9vazEyMzQ1Njc4OTAxMg';
const MODEL = { id: 'test:model-a', name: 'Model A', provider: 'Test' };
const MODELS = {
  enabled: true,
  configured: true,
  groups: ['balanced'],
  models: [{ ...MODEL, group: 'balanced', description: 'Strong all-rounder', flags: { vision: false, web: false, thinking: true, code: false }, available: true }],
};
const now = new Date().toISOString();
const ANSWER = 'Yaman is an **evening** raga.\n\n```js\nconst notes = ["Ni", "Re", "Ga"];\n```\n\n<artifact id="scale" type="markdown" title="Yaman scale">## Aroha\n\nNi Re Ga Ma Dha Ni Sa</artifact>';

interface Server {
  shares: Array<{ id: string; conversationId: string; title: string; messageCount: number; createdAt: string; updatedAt: string }>;
  created: Array<Record<string, unknown>>;
  deleted: string[];
  continued: number;
}

async function setup(page: Page, opts: { theme?: 'dark' | 'light' | 'amoled'; template?: string; highContrast?: boolean; shared?: boolean } = {}): Promise<Server> {
  const server: Server = { shares: [], created: [], deleted: [], continued: 0 };
  if (opts.shared) server.shares.push({ id: SID, conversationId: C1, title: 'Raga Yaman', messageCount: 2, createdAt: now, updatedAt: now });
  const conv = { id: C1, title: 'Raga Yaman', starred: false, activeLeafId: 'a1', createdAt: now, updatedAt: now };
  const tree = {
    conversation: conv,
    messages: [
      { id: 'u1', parentId: null, role: 'user', content: [{ type: 'text', text: 'What is raga Yaman?' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: '2026-10-30T10:00:00Z' },
      { id: 'a1', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: ANSWER }], thinking: 'Recall the thaat.', thinkingMs: 4000, model: MODEL, stopReason: 'end', createdAt: '2026-10-30T10:00:01Z' },
    ],
  };
  const snapshot = {
    id: SID,
    title: 'Raga Yaman',
    createdAt: now,
    updatedAt: now,
    messages: [
      { role: 'user', text: 'What is raga Yaman?', files: [{ name: 'notes.pdf', kind: 'pdf' }], createdAt: '2026-10-30T10:00:00Z' },
      { role: 'assistant', text: ANSWER, createdAt: '2026-10-30T10:00:01Z' },
    ],
  };
  await page.addInitScript(({ fp, theme, template, highContrast }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, ...(template ? { template } : {}), highContrast, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark', template: opts.template ?? null, highContrast: !!opts.highContrast });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    const p = url.pathname;
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/conversations') return route.fulfill({ json: { items: [conv], nextCursor: null } });
    if (p === `/api/ai/conversations/${C1}`) return route.fulfill({ json: tree });
    if (p === `/api/ai/conversations/${C9}`) {
      return route.fulfill({ json: { conversation: { ...conv, id: C9 }, messages: tree.messages.map((m) => ({ ...m, id: `${m.id}-copy`, parentId: m.parentId && `${m.parentId}-copy` })) } });
    }
    if (p === '/api/ai/shares') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        server.created.push(body);
        const fresh = !server.shares.length;
        if (fresh) server.shares.push({ id: SID, conversationId: C1, title: 'Raga Yaman', messageCount: 2, createdAt: now, updatedAt: now });
        return route.fulfill({ status: fresh ? 201 : 200, json: { share: server.shares[0] } });
      }
      const only = url.searchParams.get('conversation');
      return route.fulfill({ json: { items: server.shares.filter((s) => !only || s.conversationId === only) } });
    }
    if (p === `/api/ai/shares/${SID}/continue`) {
      server.continued += 1;
      return route.fulfill({ json: { conversationId: C9 } });
    }
    if (p === `/api/ai/shares/${SID}`) {
      if (req.method() === 'DELETE') {
        server.deleted.push(SID);
        server.shares = [];
        return route.fulfill({ json: { ok: true } });
      }
      return server.shares.length || opts.shared === undefined
        ? route.fulfill({ json: { share: snapshot }, headers: { 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex, nofollow' } })
        : route.fulfill({ status: 404, json: { error: 'not_found' } });
    }
    if (p.startsWith('/api/ai/shares/')) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
};

test('a new chat has no Share button; a saved chat does', async ({ page }) => {
  await setup(page, { shared: false });
  await page.goto('/vinaxai');
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share chat' })).toHaveCount(0);
  await page.goto(`/vinaxai/c/${C1}`);
  await expect(page.getByRole('button', { name: 'Share chat' })).toBeVisible();
});

test('create a link, copy it, update it and stop sharing, all from the keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = await setup(page, { shared: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/vinaxai/c/${C1}`);
  const shareButton = page.getByRole('button', { name: 'Share chat' });
  await shareButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Share chat' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Files you added show by name only/)).toBeVisible();
  await expect(dialog.getByText(/Messages you send after this aren’t included/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await axe(page);

  await dialog.getByRole('button', { name: /Create link/ }).click();
  const shared = page.getByRole('dialog', { name: 'Shared chat' });
  const field = shared.getByRole('textbox', { name: /Anyone with this link/ });
  await expect(field).toHaveValue(new RegExp(`/vinaxai/share/${SID}$`));
  expect(server.created).toEqual([{ conversationId: C1 }]);
  await expect(shared.getByRole('button', { name: 'Copy link' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Link copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/vinaxai/share/${SID}$`));
  await axe(page);

  await shared.getByRole('button', { name: 'Update link' }).click();
  await expect.poll(() => server.created.length).toBe(2);

  await shared.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(shared.getByText(/The link stops working for everyone/)).toBeVisible();
  await shared.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(page.getByRole('dialog', { name: 'Share chat' }).getByRole('button', { name: /Create link/ })).toBeVisible();
  expect(server.deleted).toEqual([SID]);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(shareButton).toBeFocused();
});

test('the shared page opens signed out: title, label, turns, artifacts, no composer', async ({ page }) => {
  await setup(page);
  await page.goto(`/vinaxai/share/${SID}?e2e-signed-out`);
  await expect(page.getByRole('heading', { level: 1, name: 'Raga Yaman' })).toBeVisible();
  await expect(page.getByText('Shared VinaX AI chat', { exact: true })).toBeVisible();
  await expect(page.getByText('What is raga Yaman?')).toBeVisible();
  await expect(page.getByText('notes.pdf')).toBeVisible();
  await expect(page.getByText(/PDF · not included/)).toBeVisible();
  await expect(page.locator('.vx-ai-md strong', { hasText: 'evening' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome to VinaX' })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('link', { name: 'Start your own chat' }).first()).toHaveAttribute('href', '/vinaxai');
  await expect(page.getByRole('link', { name: 'Report this chat' })).toHaveAttribute('href', /^mailto:/);
  await page.getByRole('button', { name: /Yaman scale/ }).click();
  const panel = page.getByRole('complementary', { name: 'Artifact: Yaman scale' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Aroha' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await axe(page);
});

const LOOKS: Array<{ theme: 'dark' | 'light' | 'amoled'; template: string; highContrast?: boolean }> = [
  ...['lumen', 'verdant', 'monsoon', 'harbour', 'verse', 'onyx'].flatMap((template) => (['dark', 'light'] as const).map((theme) => ({ theme, template }))),
  { theme: 'amoled', template: 'lumen' },
  { theme: 'dark', template: 'lumen', highContrast: true },
  { theme: 'light', template: 'lumen', highContrast: true },
];
for (const look of LOOKS) {
  test(`no WCAG A/AA violations on the shared page: ${look.template}, ${look.theme}${look.highContrast ? ', high contrast' : ''}`, async ({ page }) => {
    await setup(page, look);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/vinaxai/share/${SID}?e2e-signed-out`);
    await expect(page.getByRole('heading', { level: 1, name: 'Raga Yaman' })).toBeVisible();
    await page.waitForTimeout(300);
    await axe(page);
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the shared page fits, and an artifact opens as a sheet that Escape closes', async ({ page }) => {
    await setup(page);
    await page.goto(`/vinaxai/share/${SID}?e2e-signed-out`);
    await expect(page.getByRole('heading', { level: 1, name: 'Raga Yaman' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: /Yaman scale/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Artifact: Yaman scale' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
});

test('a link that was stopped says so', async ({ page }) => {
  await setup(page, { shared: false });
  await page.goto(`/vinaxai/share/${SID}?e2e-signed-out`);
  await expect(page.getByRole('heading', { name: 'This shared chat isn’t available' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start your own chat' })).toBeVisible();
});

test('a signed-in reader continues the chat in a new chat of their own', async ({ page }) => {
  const server = await setup(page);
  await page.goto(`/vinaxai/share/${SID}`);
  await page.getByRole('button', { name: 'Continue this chat' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C9}$`));
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
  expect(server.continued).toBe(1);
});

test('settings list the shared links; stop sharing one there', async ({ page }) => {
  const server = await setup(page, { shared: true });
  await page.goto(`/vinaxai/c/${C1}`);
  await page.getByRole('button', { name: 'VinaX AI settings' }).click();
  const settings = page.getByRole('dialog', { name: 'VinaX AI settings' });
  await expect(settings.getByRole('heading', { name: 'Shared links' })).toBeVisible();
  await expect(settings.getByRole('link', { name: 'Raga Yaman' })).toHaveAttribute('href', `/vinaxai/share/${SID}`);
  await expect(settings.getByRole('button', { name: 'Copy link to Raga Yaman' })).toBeVisible();
  await settings.getByRole('button', { name: 'Stop sharing Raga Yaman' }).click();
  await expect(settings.getByRole('button', { name: 'Keep' })).toBeFocused();
  await axe(page);
  await settings.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(settings.getByText(/You haven’t shared any chats/)).toBeVisible();
  expect(server.deleted).toEqual([SID]);
});
