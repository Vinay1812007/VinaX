// @vitest-environment jsdom
/**
 * VinaX AI sharing on the page: the Share chat dialog (create, update, stop
 * with a confirmation, Escape closes) and the snapshot turned into a thread.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareDialog } from './ShareDialog';
import { sharedThread } from './SharedChatView';
import { collectVersions } from './artifacts';
import type { SharedChat } from './types';

const C1 = '11111111-1111-4111-8111-111111111111';
const SID = 'AAAAAAAAAAAAAAAAAAAAAA';
const SUMMARY = { id: SID, conversationId: C1, title: 'Ragas', messageCount: 2, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mount(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ShareDialog conversationId={C1} title="Ragas" onClose={onClose} /></QueryClientProvider>);
  return onClose;
}

describe('ShareDialog', () => {
  it('explains what is shared, creates the link and shows it', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (init.method === 'POST') return reply({ share: SUMMARY }, 201);
      return reply({ items: [] });
    }));
    mount();
    expect(await screen.findByRole('button', { name: /Create link/ })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Share chat' })).toBeTruthy();
    expect(screen.getByText(/Files you added show by name only/)).toBeTruthy();
    expect(screen.getByText(/Messages you send after this aren’t included/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create link/ }));
    const field = (await screen.findByLabelText(/Anyone with this link/)) as HTMLInputElement;
    expect(field.value).toMatch(new RegExp(`/vinaxai/share/${SID}$`));
    expect(calls.find((c) => c.method === 'POST')?.body).toBe(JSON.stringify({ conversationId: C1 }));
    expect(calls[0].url).toContain(`/api/ai/shares?conversation=${C1}`);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update link' })).toBeTruthy();
  });

  it('stop sharing asks first, then deletes the link', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'DELETE') { deleted.push(url); return reply({ ok: true }); }
      return reply({ items: [SUMMARY] });
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    expect(screen.getByText(/The link stops working for everyone/)).toBeTruthy();
    expect(deleted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Create link/ })).toBeTruthy());
    expect(deleted[0]).toContain(`/api/ai/shares/${SID}`);
  });

  it('a failure is said plainly; Escape closes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => (init.method === 'POST' ? reply({ error: 'too_large' }, 413) : reply({ items: [] }))));
    const onClose = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Create link/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/too long to share/);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('sharedThread', () => {
  it('chains the turns so artifact versions count across replies', () => {
    const share: SharedChat = {
      id: SID, title: 'Ragas', createdAt: 'x', updatedAt: 'x',
      messages: [
        { role: 'user', text: 'Draw it', files: [{ name: 'a.png', kind: 'image' }], createdAt: '1' },
        { role: 'assistant', text: '<artifact id="d" type="svg" title="D"><svg/></artifact>', createdAt: '2' },
        { role: 'user', text: 'Again', createdAt: '3' },
        { role: 'assistant', text: '<artifact id="d" type="svg" title="D"><svg></svg></artifact>', createdAt: '4' },
      ],
    };
    const thread = sharedThread(share);
    expect(thread.map((m) => m.parentId)).toEqual([null, 'shared-0', 'shared-1', 'shared-2']);
    expect(collectVersions(thread).get('d')?.map((v) => v.messageId)).toEqual(['shared-1', 'shared-3']);
  });
});
