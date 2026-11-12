/**
 * VinaX AI Cowork against the built app, /api/ai/cowork* answered by the
 * test: locked for other accounts (and the sidebar says so), the new-task
 * form fits a phone, and a task shows Claude's plan, its steps, an approval
 * and the file it made, all on screen at phone width.
 */
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const SID = 'sesn_011Task';
const INFO = {
  allowed: true, configured: true, ready: true,
  models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', description: 'Quick and low-cost' }],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', budgetCents: 500, minBudgetCents: 50, maxBudgetCents: 20000, maxUploadBytes: 31457280,
  tasks: [{ id: SID, title: 'Telugu hits 2026 spreadsheet', status: 'idle', createdAt: '2026-11-12T09:00:00Z', updatedAt: '2026-11-12T09:20:00Z', costCents: 84, budgetCents: 500, model: 'claude-haiku-5-5' }],
};
const TASK = { id: SID, title: 'Telugu hits 2026 spreadsheet', status: 'idle', createdAt: '2026-11-12T09:00:00Z', updatedAt: null, costCents: 84, budgetCents: 500, model: 'claude-haiku-5-5' };
const HISTORY = [
  { type: 'user.message', id: 'sevt_u', processed_at: 'x', content: [{ type: 'text', text: 'Research the top 10 Telugu songs of 2026 and make a spreadsheet with streams and composers.' }] },
  { type: 'session.status_running', id: 'sevt_r' },
  { type: 'agent.message', id: 'sevt_m', content: [{ type: 'text', text: '**Plan**\n1. Search for 2026 charts\n2. Collect streams and composers\n3. Build the spreadsheet\n4. Check it' }] },
  { type: 'agent.tool_use', id: 'sevt_t1', name: 'web_search', input: { query: 'top Telugu songs 2026 streams' }, evaluated_permission: 'allow' },
  { type: 'agent.tool_result', id: 'sevt_t1r', tool_use_id: 'sevt_t1', content: [{ type: 'text', text: '10 results' }] },
  { type: 'agent.tool_use', id: 'sevt_t2', name: 'bash', input: { command: 'python build_sheet.py --out /mnt/session/outputs/telugu-hits-2026.xlsx' }, evaluated_permission: 'allow' },
  { type: 'agent.tool_result', id: 'sevt_t2r', tool_use_id: 'sevt_t2', content: [{ type: 'text', text: 'wrote 10 rows' }] },
  { type: 'agent.tool_use', id: 'sevt_ask', name: 'bash', input: { command: 'rm -rf /workspace/scratch' }, evaluated_permission: 'ask' },
  { type: 'session.usage', id: 'sevt_us', list_cost: { amount: '84', currency: 'USD' }, budget: { type: 'limit', max_list_cost: { amount: '500', currency: 'USD' } } },
  { type: 'session.status_idle', id: 'sevt_i', stop_reason: { type: 'requires_action', event_ids: ['sevt_ask'] } },
];

async function setup(page: Page, info: unknown = INFO, width = 360): Promise<string[]> {
  const sent: string[] = [];
  await page.setViewportSize({ width, height: 780 });
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
    const p = url.pathname;
    if (p === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (p === '/api/ai/models') return route.fulfill({ json: { enabled: true, configured: true, groups: [], models: [], cowork: { allowed: (info as { allowed: boolean }).allowed, configured: true } } });
    if (p === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (p === '/api/ai/cowork') return route.fulfill({ json: info });
    if (p === `/api/ai/cowork/tasks/${SID}`) return route.fulfill({ json: { task: TASK } });
    if (p === `/api/ai/cowork/tasks/${SID}/stream`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' });
    if (p === `/api/ai/cowork/tasks/${SID}/events` && r.method() === 'GET') return route.fulfill({ json: { data: HISTORY, next_page: null } });
    if (p === `/api/ai/cowork/tasks/${SID}/events`) {
      sent.push(r.postData() ?? '');
      return route.fulfill({ json: { ok: true } });
    }
    if (p === `/api/ai/cowork/tasks/${SID}/outputs`) return route.fulfill({ json: { files: [{ id: 'file_011Sheet', name: 'telugu-hits-2026.xlsx', size: 18_432, mime: null, createdAt: null }] } });
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return sent;
}

const shot = (page: Page, name: string) => (process.env.VX_SHOTS ? page.screenshot({ path: `${process.env.VX_SHOTS}/${name}.png`, fullPage: false }) : Promise.resolve());

const noSideScroll = async (page: Page) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
};

test('Cowork is locked for an account that may not use Claude, and the sidebar says so', async ({ page }) => {
  await setup(page, { ...INFO, allowed: false, configured: false, ready: false, tasks: [] }, 1280);
  await page.goto('/vinaxai/cowork');
  await expect(page.getByRole('heading', { name: 'Cowork is locked' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Cowork/ }).getByText('Locked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start task' })).toHaveCount(0);
  await shot(page, 'cowork-locked');
});

test('the new-task form and the task list fit a phone', async ({ page }) => {
  await setup(page);
  await page.goto('/vinaxai/cowork');
  await expect(page.getByRole('heading', { name: 'What should Claude work on?' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Telugu hits 2026 spreadsheet/ })).toBeVisible();
  await expect(page.getByLabel('Model')).toHaveValue('claude-haiku-5-5');
  await noSideScroll(page);
  await shot(page, 'cowork-home');
});

test('a task shows the plan, its steps, the approval and the file, and Allow sends the decision', async ({ page }) => {
  const sent = await setup(page);
  await page.goto(`/vinaxai/cowork/${SID}`);
  await expect(page.getByText('Search for 2026 charts')).toBeVisible();
  await expect(page.getByText('Searched the web: top Telugu songs 2026 streams')).toBeVisible();
  await expect(page.getByText(/\$0\.84 of \$5\.00 cap/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  const allow = page.getByRole('button', { name: 'Allow' });
  await expect(allow).toBeVisible();
  await expect(page.getByLabel('Message Claude')).toBeDisabled();
  await noSideScroll(page);
  await shot(page, 'cowork-task');
  await allow.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(JSON.parse(sent[0])).toEqual({ type: 'confirm', toolUseId: 'sevt_ask', allow: true });
  await expect(allow).toHaveCount(0);
});
