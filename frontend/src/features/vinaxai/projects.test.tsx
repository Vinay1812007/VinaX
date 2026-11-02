// @vitest-environment jsdom
/**
 * VinaX AI projects on the page: the order of the list, the chat's project
 * in the store (loaded, started in, moved), a new chat sending its project
 * once and only once, the Delete project choice (keep is the default) and
 * Move to project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { chatReducer, initialChat } from './chatState';
import { DeleteProjectDialog, MoveToProjectDialog } from './projectDialogs';
import { fmtSize, sortProjects } from './Projects';
import { resetChat, sendMessage, useChatStore } from './store';
import { usePrefs } from './prefs';
import type { Project } from './types';

const P1 = '33333333-3333-4333-8333-333333333331';
const P2 = '33333333-3333-4333-8333-333333333332';
const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, name: 'Raga study', description: null, instructions: null, starred: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', ...extra });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const META = ['meta', { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'm', name: 'M', provider: 'P' } }] as [string, unknown];

beforeEach(() => {
  resetChat();
  usePrefs.setState({ model: 'auto', extendedThinking: false, webSearch: 'auto', artifacts: true, personalName: '', personalAbout: '', personalInstructions: '', style: 'normal' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}>{ui}</QueryClientProvider></MemoryRouter>);
}

describe('the projects list', () => {
  it('puts starred projects first, then the most recently changed', () => {
    const items = [project('a', { updatedAt: '2026-11-01T10:00:00Z' }), project('b', { updatedAt: '2026-11-02T10:00:00Z' }), project('c', { starred: true, updatedAt: '2026-10-01T10:00:00Z' })];
    expect(sortProjects(items).map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(2048)).toBe('2 KB');
  });
});

describe('the chat\'s project in the store', () => {
  it('comes with a loaded chat, is set by a new chat started in a project, changes with a move and clears on reset', () => {
    let s = chatReducer(initialChat(), { type: 'load', conversation: { id: 'c1', title: 't', starred: false, activeLeafId: null, projectId: P1, createdAt: '', updatedAt: '' }, messages: [] });
    expect(s.projectId).toBe(P1);
    // A message in an existing chat never changes its project.
    s = chatReducer(s, { type: 'send', text: 'hi', parentId: null, now: 'x', projectId: P2 });
    expect(s.projectId).toBe(P1);
    s = chatReducer(s, { type: 'project', projectId: null });
    expect(s.projectId).toBeNull();
    const fresh = chatReducer(initialChat(), { type: 'send', text: 'hi', parentId: null, now: 'x', projectId: P2 });
    expect(fresh.projectId).toBe(P2);
    expect(chatReducer(fresh, { type: 'reset' }).projectId).toBeNull();
    expect(chatReducer(initialChat(), { type: 'send', text: 'hi', parentId: null, now: 'x' }).projectId).toBeNull();
  });

  it('a new chat sends its project; the next message in it does not', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(sse([META, ['done', { stopReason: 'end' }]]), { status: 200 });
    }));
    await sendMessage('What thaat is Yaman?', { projectId: P1 });
    expect(bodies[0]).toMatchObject({ conversationId: null, projectId: P1 });
    expect(useChatStore.getState()).toMatchObject({ conversationId: 'c1', projectId: P1 });
    await sendMessage('And Bhairav?', { projectId: P1 });
    expect(bodies[1]).toMatchObject({ conversationId: 'c1' });
    expect(bodies[1]).not.toHaveProperty('projectId');
    resetChat();
    await sendMessage('Plain chat');
    expect(bodies[2]).not.toHaveProperty('projectId');
  });
});

describe('DeleteProjectDialog', () => {
  it('keeps the chats unless "Delete them too" is picked', async () => {
    const onDelete = vi.fn(async () => undefined);
    wrap(<DeleteProjectDialog project={project(P1)} chats={3} onDelete={onDelete} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Delete this project?' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Keep them as ordinary chats' }) as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Delete them too' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('delete'));
  });

  it('a project without chats offers no choice; Escape closes', () => {
    const onClose = vi.fn();
    wrap(<DeleteProjectDialog project={project(P1)} chats={0} onDelete={vi.fn()} onClose={onClose} />);
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MoveToProjectDialog', () => {
  it('lists the projects, moves the chat and updates the open chat', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (init.method === 'PATCH') return reply({ conversation: { id: 'c1', projectId: P2 } });
      return reply({ items: [project(P1), project(P2, { name: 'Essays' })] });
    }));
    useChatStore.getState().dispatch({ type: 'load', conversation: { id: 'c1', title: 'Yaman', starred: false, activeLeafId: null, projectId: P1, createdAt: '', updatedAt: '' }, messages: [] });
    const onClose = vi.fn();
    wrap(<MoveToProjectDialog chat={{ id: 'c1', title: 'Yaman', starred: false, activeLeafId: null, projectId: P1, createdAt: '', updatedAt: '' }} onClose={onClose} />);
    expect(await screen.findByRole('button', { name: 'Essays' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Raga study/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'No project' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Essays' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/ai/conversations/c1', body: JSON.stringify({ projectId: P2 }) });
    expect(useChatStore.getState().projectId).toBe(P2);
  });
});
