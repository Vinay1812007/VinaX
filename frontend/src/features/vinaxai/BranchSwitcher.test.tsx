// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BranchSwitcher, UserMessage } from './Message';
import { useChatStore } from './store';
import { initialChat } from './chatState';
import type { ChatMessage } from './types';

const msg = (id: string, parentId: string | null, role: 'user' | 'assistant', at: string): ChatMessage => ({ id, parentId, role, text: `text ${id}`, thinking: '', thinkingMs: null, model: null, stopReason: 'end', error: null, createdAt: at });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const messages = { u1: msg('u1', null, 'user', '1'), a1: msg('a1', 'u1', 'assistant', '2'), u1b: msg('u1b', null, 'user', '3'), a1b: msg('a1b', 'u1b', 'assistant', '4') };
  useChatStore.setState({ ...initialChat(), conversationId: 'c1', messages, leafId: 'a1b' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('<BranchSwitcher />', () => {
  it('shows ‹ 2 / 2 › and switches to the other version (remembering it on the server)', () => {
    render(<BranchSwitcher message={useChatStore.getState().messages.u1b} />);
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next version' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(useChatStore.getState().leafId).toBe('a1');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/ai/conversations/c1');
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body))).toEqual({ activeLeafId: 'a1' });
  });

  it('is hidden for a message with one version', () => {
    const { container } = render(<BranchSwitcher message={useChatStore.getState().messages.a1} />);
    expect(container.textContent).toBe('');
  });

  it('is disabled while a reply is being written', () => {
    useChatStore.setState({ streaming: true });
    render(<BranchSwitcher message={useChatStore.getState().messages.u1b} />);
    expect(screen.getByRole('button', { name: 'Previous version' })).toHaveProperty('disabled', true);
  });
});

describe('<UserMessage /> edit', () => {
  it('Edit opens the text; Enter sends the change, Escape cancels', () => {
    const onEdit = vi.fn();
    render(<UserMessage message={useChatStore.getState().messages.u1} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const box = screen.getByRole('textbox', { name: 'Edit your message' });
    fireEvent.change(box, { target: { value: 'a better question' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('a better question');
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit your message' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
