// @vitest-environment jsdom
/**
 * VinaX AI Cowork on the page: locked for other accounts; a new task is set
 * up, created, its stream opened and only then its first message sent; a
 * step that asks shows Allow / Deny and sends the decision; outputs download.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/useAccount', () => ({ useAccount: () => ({ session: 'tok', user: { name: 'Vinay' } }) }));
vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'tok', user: { name: 'Vinay' } }) }));

const { CoworkView } = await import('./CoworkView');

const SID = 'sesn_011Task';
const INFO = {
  allowed: true, configured: true, ready: false,
  models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Best for most tasks' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Quicker' }],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', budgetCents: 500, minBudgetCents: 50, maxBudgetCents: 20000, maxUploadBytes: 31457280,
  tasks: [{ id: 'sesn_011Old', title: 'Old report', status: 'idle', createdAt: '2026-11-11T10:00:00Z', updatedAt: null, costCents: 120, budgetCents: 500, model: 'claude-opus-5-5' }],
};
/** A JSON request body, or null. */
function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (events: unknown[]) => new Response(events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

type Call = { url: string; method: string; body: unknown; signal?: AbortSignal | null };

function mount(path: string, answer: (c: Call) => Response | Promise<Response>, state?: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = parse(init?.body);
    const c = { url: String(url), method: init?.method ?? 'GET', body, signal: init?.signal };
    calls.push(c);
    return answer(c);
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
        <Routes>
          <Route path="/vinaxai/cowork" element={<CoworkView />} />
          <Route path="/vinaxai/cowork/:taskId" element={<CoworkView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

const route = (c: Call) => c.url.replace(/^.*\/api\/ai\/cowork/, '') || '/';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<CoworkView />', () => {
  it('is locked for an account that may not use Claude', async () => {
    mount('/vinaxai/cowork', () => reply({ ...INFO, allowed: false, tasks: [] }));
    expect(await screen.findByText('Cowork is locked')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start task' })).toBeNull();
  });

  it('a new task: setup, create with the cap, then stream first and the first message after', async () => {
    const calls = mount('/vinaxai/cowork', (c) => {
      const r = route(c);
      if (r === '/' && c.method === 'GET') return reply(INFO);
      if (r === '/setup') return reply({ ok: true, created: true, updated: false });
      if (r === '/' && c.method === 'POST') return reply({ task: { id: SID, title: 'Make a playlist report', status: 'idle', createdAt: null, updatedAt: null, costCents: 0, budgetCents: 300, model: 'claude-sonnet-5-5' } });
      if (r === `/tasks/${SID}`) return reply({ task: { id: SID, title: 'Make a playlist report', status: 'idle', createdAt: null, updatedAt: null, costCents: 0, budgetCents: 300, model: 'claude-sonnet-5-5' } });
      if (r === `/tasks/${SID}/stream`) return sse([{ type: 'session.status_running', id: 'sevt_r' }, { type: 'agent.message', id: 'sevt_m', content: [{ type: 'text', text: 'On it: first I will list the songs.' }] }]);
      if (r === `/tasks/${SID}/events` && c.method === 'GET') return reply({ data: [], next_page: null });
      if (r === `/tasks/${SID}/events`) return reply({ ok: true });
      if (r === `/tasks/${SID}/outputs`) return reply({ files: [] });
      return reply({ error: 'not_found' }, 404);
    });
    expect(await screen.findByText('Old report')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Make a playlist report\nwith charts' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5-5' } });
    fireEvent.change(screen.getByLabelText('Spend cap (USD)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
    expect(await screen.findByText('On it: first I will list the songs.')).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => route(c) === `/tasks/${SID}/events` && c.method === 'POST')).toBe(true));
    const create = calls.find((c) => route(c) === '/' && c.method === 'POST')!;
    expect(create.body).toEqual({ title: 'Make a playlist report', model: 'claude-sonnet-5-5', effort: 'high', budgetCents: 300, files: [] });
    const order = calls.map((c) => `${c.method} ${route(c)}`);
    expect(order.indexOf('POST /setup')).toBeLessThan(order.indexOf('POST /'));
    expect(order.indexOf(`GET /tasks/${SID}/stream`)).toBeLessThan(order.indexOf(`POST /tasks/${SID}/events`));
    expect(calls.find((c) => route(c) === `/tasks/${SID}/events` && c.method === 'POST')!.body).toEqual({ type: 'message', text: 'Make a playlist report\nwith charts' });
  });

  it('a brand-new task with no events yet keeps its stream open when the first message goes out', async () => {
    let streamOpenAtSend: boolean | null = null;
    const calls = mount(`/vinaxai/cowork/${SID}`, (c) => {
      const r = route(c);
      if (r === '/' && c.method === 'GET') return reply({ ...INFO, ready: true });
      if (r === `/tasks/${SID}`) return reply({ task: { id: SID, title: 'Fresh', status: 'idle', createdAt: null, updatedAt: null, costCents: 0, budgetCents: 500, model: 'claude-opus-5-5' } });
      // A real stream stays open; this one never sends anything.
      if (r === `/tasks/${SID}/stream`) return new Response(new ReadableStream({ start() { /* open, silent */ } }), { headers: { 'content-type': 'text/event-stream' } });
      if (r === `/tasks/${SID}/events` && c.method === 'GET') return reply({ data: [], next_page: null });
      if (r === `/tasks/${SID}/events`) {
        streamOpenAtSend = calls.find((x) => route(x) === `/tasks/${SID}/stream`)?.signal?.aborted === false;
        return reply({ ok: true });
      }
      if (r === `/tasks/${SID}/outputs`) return reply({ files: [] });
      return reply({ error: 'not_found' }, 404);
    }, { firstMessage: 'Plan my week' });
    await waitFor(() => expect(streamOpenAtSend).not.toBeNull());
    expect(streamOpenAtSend).toBe(true);
    expect(await screen.findByText('Plan my week')).toBeTruthy();
    // And it stays open afterwards: the events the message causes arrive on it.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((x) => route(x) === `/tasks/${SID}/stream`).every((x) => x.signal?.aborted === false)).toBe(true);
  });

  it('a step that asks shows Allow / Deny; Allow sends the decision with the stream open', async () => {
    const calls = mount(`/vinaxai/cowork/${SID}`, (c) => {
      const r = route(c);
      if (r === '/' && c.method === 'GET') return reply({ ...INFO, ready: true });
      if (r === `/tasks/${SID}`) return reply({ task: { id: SID, title: 'Clean up', status: 'idle', createdAt: null, updatedAt: null, costCents: 12, budgetCents: 500, model: 'claude-opus-5-5' } });
      if (r === `/tasks/${SID}/stream`) return sse([]);
      if (r === `/tasks/${SID}/events` && c.method === 'GET') {
        return reply({
          data: [
            { type: 'user.message', id: 'sevt_u', processed_at: '2026-11-12T10:00:00Z', content: [{ type: 'text', text: 'Tidy the build folder' }] },
            { type: 'agent.tool_use', id: 'sevt_ask', name: 'bash', input: { command: 'rm -rf build' }, evaluated_permission: 'ask' },
            { type: 'session.status_idle', id: 'sevt_i', stop_reason: { type: 'requires_action', event_ids: ['sevt_ask'] } },
          ],
          next_page: null,
        });
      }
      if (r === `/tasks/${SID}/events`) return reply({ ok: true });
      if (r === `/tasks/${SID}/outputs`) return reply({ files: [{ id: 'file_011Out', name: 'summary.md', size: 2048, mime: 'text/markdown', createdAt: null }] });
      return reply({ error: 'not_found' }, 404);
    });
    expect(await screen.findByText('Ran rm -rf build')).toBeTruthy();
    expect(screen.getByText(/Claude is waiting for you to allow or deny the step above/)).toBeTruthy();
    expect(screen.getAllByText(/Waiting for you/)).toHaveLength(1);
    expect((screen.getByLabelText('Message Claude') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(calls.some((c) => route(c) === `/tasks/${SID}/events` && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => route(c) === `/tasks/${SID}/events` && c.method === 'POST')!.body).toEqual({ type: 'confirm', toolUseId: 'sevt_ask', allow: true });
    expect(await screen.findByText('summary.md')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
