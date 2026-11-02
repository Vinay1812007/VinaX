/**
 * VinaX AI projects, in a real browser against the built app, with /api/ai/*
 * answered by a small in-test server that keeps state: create a project,
 * write its instructions, add a text file, start a chat in it (the request
 * carries the project and the server files the chat there), move another
 * chat into it, delete it; the Projects entry in the phone drawer; and
 * accessibility scans of the pages and dialogs in dark and light.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const P1 = '3b0f6c1e-2a4d-4c8e-9f10-1a2b3c4d5e6f';
const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const C2 = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const MODEL = { id: 'test:model-a', name: 'Model A', provider: 'Test' };
const MODELS = {
  enabled: true,
  configured: true,
  groups: ['balanced'],
  models: [{ ...MODEL, group: 'balanced', description: 'Strong all-rounder', flags: { vision: false, web: false, thinking: true, code: false }, available: true }],
};
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const now = new Date().toISOString();

interface Project { id: string; name: string; description: string | null; instructions: string | null; starred: boolean; createdAt: string; updatedAt: string }
interface Conv { id: string; title: string; starred: boolean; activeLeafId: string | null; projectId: string | null; createdAt: string; updatedAt: string }
interface File { id: string; name: string; mime: string; kind: 'text' | 'pdf' | 'image'; size: number; chars: number; createdAt: string }
interface Server {
  projects: Project[];
  conversations: Conv[];
  files: Map<string, File[]>;
  posts: Array<Record<string, unknown>>;
  patches: Array<{ path: string; body: Record<string, unknown> }>;
  uploads: string[];
  deletes: string[];
}

async function setup(page: Page, opts: { theme?: 'dark' | 'light'; withProject?: boolean } = {}): Promise<Server> {
  const server: Server = {
    projects: opts.withProject ? [{ id: P1, name: 'Raga study', description: 'Notes for my music class', instructions: 'Answer with the thaat first.', starred: false, createdAt: now, updatedAt: now }] : [],
    conversations: [{ id: C2, title: 'Bhairav at dawn', starred: false, activeLeafId: null, projectId: opts.withProject ? null : null, createdAt: now, updatedAt: now }],
    files: new Map(opts.withProject ? [[P1, [{ id: 'f0', name: 'syllabus.md', mime: 'text/markdown', kind: 'text', size: 120, chars: 120, createdAt: now }]]] : []),
    posts: [],
    patches: [],
    uploads: [],
    deletes: [],
  };
  await page.addInitScript(({ fp, theme }) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme, pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { fp: latestNotesFingerprint(), theme: opts.theme ?? 'dark' });
  const detail = (p: Project) => {
    const files = server.files.get(p.id) ?? [];
    const chats = server.conversations.filter((c) => c.projectId === p.id);
    return { project: { ...p, chatCount: chats.length, fileCount: files.length }, files, chats, limits: { files: 20, chars: 200_000, usedChars: files.reduce((n, f) => n + f.chars, 0) } };
  };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    const p = url.pathname;
    const m = req.method();
    if (p === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (p === '/api/ai/projects') {
      if (m === 'POST') {
        const body = req.postDataJSON() as { name: string; description?: string | null };
        const made: Project = { id: P1, name: body.name, description: body.description ?? null, instructions: null, starred: false, createdAt: now, updatedAt: now };
        server.projects.push(made);
        return route.fulfill({ status: 201, json: { project: made } });
      }
      return route.fulfill({ json: { items: server.projects.map((x) => detail(x).project) } });
    }
    if (p === `/api/ai/projects/${P1}`) {
      const proj = server.projects.find((x) => x.id === P1);
      if (!proj) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (m === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        server.patches.push({ path: p, body });
        Object.assign(proj, body, { updatedAt: new Date().toISOString() });
        return route.fulfill({ json: { project: proj } });
      }
      if (m === 'DELETE') {
        server.deletes.push(`${p}?${url.searchParams}`);
        server.projects = server.projects.filter((x) => x.id !== P1);
        for (const c of server.conversations) if (c.projectId === P1) c.projectId = null;
        return route.fulfill({ json: { ok: true, chats: 0 } });
      }
      return route.fulfill({ json: detail(proj) });
    }
    if (p === '/api/ai/attachments' && m === 'POST') {
      const project = url.searchParams.get('projectId');
      const name = url.searchParams.get('name') ?? 'file';
      server.uploads.push(`${name}|${project}`);
      const f: File = { id: `f${server.uploads.length}`, name, mime: 'text/plain', kind: 'text', size: 40, chars: 40, createdAt: now };
      if (project) server.files.set(project, [...(server.files.get(project) ?? []), f]);
      return route.fulfill({ json: { id: f.id, name, mime: f.mime, size: f.size, kind: f.kind } });
    }
    if (p.startsWith('/api/ai/attachments/') && m === 'DELETE') {
      const id = p.split('/').pop();
      for (const [k, list] of server.files) server.files.set(k, list.filter((f) => f.id !== id));
      return route.fulfill({ json: { ok: true } });
    }
    if (p === '/api/ai/conversations') {
      const only = url.searchParams.get('project');
      return route.fulfill({ json: { items: server.conversations.filter((c) => !only || c.projectId === only), nextCursor: null } });
    }
    if (p.startsWith('/api/ai/conversations/')) {
      const id = p.split('/').pop()!;
      const c = server.conversations.find((x) => x.id === id);
      if (!c) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (m === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        server.patches.push({ path: p, body });
        if ('projectId' in body) c.projectId = body.projectId as string | null;
        return route.fulfill({ json: { conversation: c } });
      }
      return route.fulfill({ json: { conversation: c, messages: [] } });
    }
    if (p === '/api/ai/chat') {
      const body = req.postDataJSON() as Record<string, unknown>;
      server.posts.push(body);
      // The server files a new chat in the project it was sent from.
      if (!body.conversationId) server.conversations.unshift({ id: C1, title: 'Yaman', starred: false, activeLeafId: null, projectId: (body.projectId as string) ?? null, createdAt: now, updatedAt: now });
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse([
          ['meta', { conversationId: C1, userMessageId: '11111111-1111-4111-8111-111111111111', assistantMessageId: '22222222-2222-4222-8222-222222222222', model: MODEL }],
          ['title', { title: 'Yaman' }],
          ['text', { delta: 'Yaman belongs to the **Kalyan** thaat.' }],
          ['done', { stopReason: 'end' }],
        ]),
      });
    }
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
};

test('create a project, give it instructions and a file, start a chat in it, move a chat in, delete it', async ({ page }) => {
  const server = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/vinaxai');
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/vinaxai\/projects$/);
  await expect(page.getByRole('heading', { name: 'Keep related chats together' })).toBeVisible();

  // Create.
  await page.getByRole('button', { name: 'New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await expect(create.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await axe(page);
  await create.getByRole('textbox', { name: 'Name' }).fill('Raga study');
  await create.getByRole('textbox', { name: /Description/ }).fill('Notes for my music class');
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/vinaxai/project/${P1}$`));
  await expect(page.getByRole('heading', { level: 2, name: 'Raga study' })).toBeVisible();
  await expect(page.getByText('Notes for my music class')).toBeVisible();

  // Instructions.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const instructions = page.getByRole('textbox', { name: 'Project instructions' });
  await expect(instructions).toBeFocused();
  await instructions.fill('Answer with the thaat first.');
  await page.getByRole('button', { name: 'Save instructions' }).click();
  await expect(page.locator('.vx-ai-proj-instr')).toHaveText('Answer with the thaat first.');
  expect(server.patches).toContainEqual({ path: `/api/ai/projects/${P1}`, body: { instructions: 'Answer with the thaat first.' } });

  // A text file.
  await page.locator('.vx-ai-proj-box input[type="file"]').setInputFiles({ name: 'syllabus.md', mimeType: 'text/markdown', buffer: Buffer.from('# Ragas\nYaman, Bhairav') });
  await expect(page.getByRole('list', { name: 'Project files' }).getByText('syllabus.md')).toBeVisible();
  expect(server.uploads).toEqual([`syllabus.md|${P1}`]);
  await expect(page.getByText(/1 file of 20/)).toBeVisible();
  await axe(page);

  // A chat started here carries the project, and the server files it there.
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('What thaat is Yaman?');
  await box.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C1}$`));
  await expect(page.locator('.vx-ai-md strong', { hasText: 'Kalyan' })).toBeVisible();
  expect(server.posts).toHaveLength(1);
  expect(server.posts[0]).toMatchObject({ conversationId: null, projectId: P1, content: [{ type: 'text', text: 'What thaat is Yaman?' }] });
  expect(server.conversations.find((c) => c.id === C1)?.projectId).toBe(P1);
  const chip = page.getByRole('link', { name: 'Project: Raga study' });
  await expect(chip).toBeVisible();
  // A second message in that chat names the chat, not the project.
  await box.fill('And Bhairav?');
  await box.press('Enter');
  await expect.poll(() => server.posts.length).toBe(2);
  expect(server.posts[1]).toMatchObject({ conversationId: C1 });
  expect(server.posts[1]).not.toHaveProperty('projectId');

  // Move another chat into the project from its ⋯ menu.
  await page.getByRole('button', { name: 'Options for Bhairav at dawn' }).click();
  await page.getByRole('menuitem', { name: 'Move to project…' }).click();
  const move = page.getByRole('dialog', { name: 'Move to project' });
  await expect(move).toBeVisible();
  await axe(page);
  await move.getByRole('button', { name: 'Raga study' }).click();
  await expect(move).toHaveCount(0);
  await expect(page.getByText('Moved to Raga study')).toBeVisible();
  expect(server.patches).toContainEqual({ path: `/api/ai/conversations/${C2}`, body: { projectId: P1 } });

  // Back to the project: both chats are listed.
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/vinaxai/project/${P1}$`));
  const chats = page.getByRole('region', { name: 'Chats in this project' });
  await expect(chats.getByRole('link', { name: /Yaman/ })).toBeVisible();
  await expect(chats.getByRole('link', { name: /Bhairav at dawn/ })).toBeVisible();

  // Delete: keeping its chats is the default.
  await page.getByRole('button', { name: 'Delete project' }).click();
  const del = page.getByRole('alertdialog', { name: 'Delete this project?' });
  await expect(del.getByRole('radio', { name: 'Keep them as ordinary chats' })).toBeChecked();
  await expect(del.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await axe(page);
  await del.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/vinaxai\/projects$/);
  expect(server.deletes).toEqual([`/api/ai/projects/${P1}?chats=keep`]);
  await expect(page.getByRole('heading', { name: 'Keep related chats together' })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations on the projects pages and the edit dialog: ${theme}`, async ({ page }) => {
    await setup(page, { theme, withProject: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai/projects');
    await expect(page.getByRole('link', { name: /Raga study/ })).toBeVisible();
    await axe(page);
    await page.getByRole('link', { name: /Raga study/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Raga study' })).toBeVisible();
    await expect(page.getByText('syllabus.md')).toBeVisible();
    await axe(page);
    await page.getByRole('button', { name: 'Edit project name and description' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit project' })).toBeVisible();
    await axe(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit project name and description' })).toBeFocused();
  });
}

test('an unknown project says so, with a way back', async ({ page }) => {
  await setup(page);
  await page.goto(`/vinaxai/project/${P1}`);
  await expect(page.getByRole('heading', { name: 'This project isn’t available' })).toBeVisible();
  await page.getByRole('link', { name: 'All projects' }).click();
  await expect(page).toHaveURL(/\/vinaxai\/projects$/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Projects is in the drawer, and a project page fits the screen', async ({ page }) => {
    await setup(page, { withProject: true });
    await page.goto('/vinaxai');
    await page.getByRole('button', { name: 'Open chats' }).click();
    const drawer = page.getByRole('dialog', { name: 'Chats' });
    await drawer.getByRole('link', { name: 'Projects' }).click();
    await expect(drawer).toHaveCount(0);
    await page.getByRole('link', { name: /Raga study/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Raga study' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await axe(page);
  });
});
