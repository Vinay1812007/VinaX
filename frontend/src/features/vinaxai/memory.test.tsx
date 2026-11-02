// @vitest-environment jsdom
/**
 * VinaX AI memory on the page: the settings list (switches, delete one,
 * add, forget everything with a confirmation), and an incognito chat that
 * sends its flag with every message and can only be chosen before it starts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemorySettings } from './MemorySettings';
import { chatReducer, initialChat } from './chatState';
import { memoryNotice } from './api';
import { resetChat, sendMessage, setIncognito, useChatStore } from './store';
import type { MemoryState } from './types';

const N1 = '33333333-3333-4333-8333-333333333331';
const N2 = '33333333-3333-4333-8333-333333333332';
const STATE: MemoryState = {
  enabled: true,
  prefs: { use: true, learn: true },
  items: [
    { id: N1, text: 'Is learning Carnatic vocals', origin: 'chat', createdAt: '2026-11-01T10:00:00Z' },
    { id: N2, text: 'Prefers answers in Telugu', origin: 'user', createdAt: '2026-11-01T11:00:00Z' },
  ],
  max: 50,
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; method: string; body?: string };

function server(over: (c: Call) => Response | null = () => null): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? 'GET', body: init.body as string | undefined };
    calls.push(c);
    const custom = over(c);
    if (custom) return custom;
    if (c.method === 'GET') return reply(STATE);
    if (c.url.endsWith('/memories/prefs')) return reply({ prefs: { ...STATE.prefs, ...JSON.parse(c.body ?? '{}') } });
    if (c.method === 'POST') return reply({ item: { id: 'new', text: JSON.parse(c.body ?? '{}').text, origin: 'user', createdAt: '2026-11-02T10:00:00Z' } }, 201);
    if (c.method === 'DELETE') return reply({ ok: true, removed: 2 });
    return reply({});
  }));
  return calls;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemorySettings /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Memory settings', () => {
  it('lists what VinaX AI remembers, with where each came from', async () => {
    server();
    mount();
    const list = await screen.findByRole('list', { name: /What VinaX AI remembers \(2\)/ });
    expect(within(list).getByText('Is learning Carnatic vocals')).toBeTruthy();
    expect(within(list).getByText(/Added by you/)).toBeTruthy();
    expect(within(list).getByText(/Learned from a chat/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Use memory/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: /Learn from my chats/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches save to the account; Learn is disabled while memory is off', async () => {
    const calls = server();
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: /Use memory/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/api/ai/memories/prefs');
    expect(JSON.parse(put.body!)).toEqual({ use: false });
    const learn = screen.getByRole('switch', { name: /Learn from my chats/ }) as HTMLButtonElement;
    expect(learn.disabled).toBe(true);
    expect(learn.getAttribute('aria-checked')).toBe('false');
  });

  it('deletes one memory', async () => {
    const calls = server();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete memory: Is learning Carnatic vocals' }));
    await waitFor(() => expect(screen.queryByText('Is learning Carnatic vocals')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')!.url).toContain(`/api/ai/memories/${N1}`);
    expect(screen.getByText('Prefers answers in Telugu')).toBeTruthy();
  });

  it('adds a memory', async () => {
    const calls = server();
    mount();
    const field = (await screen.findByLabelText('Add a memory')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Plays the veena' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Plays the veena')).toBeTruthy();
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ text: 'Plays the veena' });
    expect(field.value).toBe('');
  });

  it('Forget everything asks first, then clears the list', async () => {
    const calls = server();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget everything' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const ask = screen.getByRole('group', { name: /Forget everything VinaX AI remembers/ });
    fireEvent.click(within(ask).getByRole('button', { name: 'Forget all 2' }));
    await waitFor(() => expect(screen.queryByRole('list')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')!.url).toMatch(/\/api\/ai\/memories$/);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it('says plainly when the owner has memory off, and refuses secrets in plain words', async () => {
    server((c) => (c.method === 'GET' ? reply({ ...STATE, enabled: false }) : null));
    mount();
    expect(await screen.findByText(/switched off for VinaX AI right now/)).toBeTruthy();
    expect((screen.getByLabelText('Add a memory') as HTMLInputElement).disabled).toBe(true);
    expect(memoryNotice('sensitive')).toMatch(/Memory doesn’t keep those/);
  });
});

describe('incognito chats', () => {
  beforeEach(() => resetChat());

  it('can only be chosen before the chat starts; loading a chat takes its flag', () => {
    let s = chatReducer(initialChat(), { type: 'incognito', on: true });
    expect(s.incognito).toBe(true);
    s = chatReducer(s, { type: 'send', text: 'hi', parentId: null, now: 'x' });
    expect(chatReducer(s, { type: 'incognito', on: false }).incognito).toBe(true);
    const loaded = chatReducer(initialChat(), { type: 'load', conversation: { id: 'c1', title: 't', starred: false, activeLeafId: null, createdAt: 'x', updatedAt: 'x', incognito: true }, messages: [] });
    expect(loaded.incognito).toBe(true);
    expect(chatReducer(loaded, { type: 'reset' }).incognito).toBe(false);
  });

  it('every message of an incognito chat carries the flag; a normal chat sends none', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const sse = `event: meta\ndata: ${JSON.stringify({ conversationId: 'c1', userMessageId: `u${bodies.length}`, assistantMessageId: `a${bodies.length}`, model: { id: 'm', name: 'M', provider: 'P' } })}\n\nevent: text\ndata: {"delta":"ok"}\n\nevent: done\ndata: {"stopReason":"end"}\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    await sendMessage('A normal question');
    expect(bodies[0]).not.toHaveProperty('incognito');
    resetChat();
    setIncognito(true);
    await sendMessage('A private question');
    await sendMessage('And another');
    expect(bodies[1].incognito).toBe(true);
    expect(bodies[2].incognito).toBe(true);
    expect(useChatStore.getState().incognito).toBe(true);
  });
});
