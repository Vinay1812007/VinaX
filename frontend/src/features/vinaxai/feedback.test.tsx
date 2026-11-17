// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssistantMessage } from './Message';
import { nextRating, NOTE_MAX } from './Feedback';
import { useChatStore } from './store';
import { chatReducer, fromServer, initialChat } from './chatState';
import type { ChatMessage, ServerMessage } from './types';

const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1', parentId: 'u1', role: 'assistant', text: 'A raga is a melodic framework.', thinking: '', thinkingMs: null,
  model: { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' }, stopReason: 'end', error: null, createdAt: '2026-11-17T10:00:00Z', ...over,
});
const question: ChatMessage = { ...reply(), id: 'u1', parentId: null, role: 'user', text: 'What is a raga?', model: null };

let posted: Array<Record<string, unknown>>;
let fail = false;

beforeEach(() => {
  posted = [];
  fail = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    posted.push(body);
    if (fail) return new Response('{"error":"unavailable"}', { status: 503 });
    const feedback = body.rating ? { rating: body.rating, ...(body.reason ? { reason: body.reason } : {}), ...(body.note ? { note: body.note } : {}) } : null;
    return Response.json({ ok: true, feedback });
  }));
  useChatStore.setState({ ...initialChat(), conversationId: 'c1', messages: { u1: question, a1: reply() }, leafId: 'a1' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = () => render(<AssistantMessage message={useChatStore.getState().messages.a1} live={false} models={[]} />);
const rerender = (r: ReturnType<typeof show>) => r.rerender(<AssistantMessage message={useChatStore.getState().messages.a1} live={false} models={[]} />);
const flush = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });

describe('nextRating', () => {
  it('a thumb sets the rating; the same thumb again takes it back', () => {
    expect(nextRating(null, 'up')).toEqual({ rating: 'up' });
    expect(nextRating({ rating: 'up' }, 'up')).toBeNull();
    expect(nextRating({ rating: 'up' }, 'down')).toEqual({ rating: 'down' });
    expect(nextRating({ rating: 'down', reason: 'wrong' }, 'down')).toBeNull();
  });
});

describe('the chat state', () => {
  it('a saved reply brings its rating; the feedback action changes it, on replies only', () => {
    const saved: ServerMessage = { id: 'a1', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: 'x' }], thinking: null, thinkingMs: null, model: null, stopReason: 'end', createdAt: 'x', feedback: { rating: 'down', reason: 'too_slow' } };
    expect(fromServer(saved).feedback).toEqual({ rating: 'down', reason: 'too_slow' });
    expect(fromServer({ ...saved, feedback: undefined })).not.toHaveProperty('feedback');
    const s = { ...initialChat(), messages: { u1: question, a1: reply() } };
    expect(chatReducer(s, { type: 'feedback', messageId: 'a1', feedback: { rating: 'up' } }).messages.a1.feedback).toEqual({ rating: 'up' });
    expect(chatReducer(s, { type: 'feedback', messageId: 'u1', feedback: { rating: 'up' } })).toBe(s);
    expect(chatReducer(s, { type: 'feedback', messageId: 'nope', feedback: null })).toBe(s);
  });
});

describe('thumbs under a reply', () => {
  it('thumbs up saves at once, shows as pressed, and a second press takes it back', async () => {
    const r = show();
    fireEvent.click(screen.getByRole('button', { name: 'Good reply' }));
    expect(useChatStore.getState().messages.a1.feedback).toEqual({ rating: 'up' });
    await flush();
    expect(posted).toEqual([{ conversationId: 'c1', messageId: 'a1', rating: 'up' }]);
    rerender(r);
    expect(screen.getByRole('button', { name: 'Good reply' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Thanks for telling us.');
    fireEvent.click(screen.getByRole('button', { name: 'Good reply' }));
    await flush();
    expect(posted[1]).toEqual({ conversationId: 'c1', messageId: 'a1', rating: null });
    expect(useChatStore.getState().messages.a1.feedback).toBeNull();
  });

  it('thumbs down asks what went wrong: a reason and a note of at most 300 characters', async () => {
    const r = show();
    fireEvent.click(screen.getByRole('button', { name: 'Bad reply' }));
    await flush();
    rerender(r);
    expect(posted[0]).toMatchObject({ rating: 'down' });
    const group = screen.getByRole('group', { name: 'What went wrong?' });
    expect([...group.querySelectorAll('.vx-ai-fb-reasons button')].map((b) => b.textContent)).toEqual(['Wrong', 'Not helpful', 'Too slow', 'Other']);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    const box = screen.getByRole('textbox', { name: 'Tell us more (optional)' });
    expect(box.getAttribute('maxLength')).toBe(String(NOTE_MAX));
    fireEvent.change(box, { target: { value: `  ${'y'.repeat(NOTE_MAX + 20)}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await flush();
    expect(posted[1]).toMatchObject({ conversationId: 'c1', messageId: 'a1', rating: 'down', reason: 'not_helpful' });
    expect(String(posted[1].note).length).toBeLessThanOrEqual(NOTE_MAX);
    expect(useChatStore.getState().messages.a1.feedback).toMatchObject({ rating: 'down', reason: 'not_helpful' });
    rerender(r);
    expect(screen.queryByRole('group', { name: 'What went wrong?' })).toBeNull();
  });

  it('Skip keeps the thumbs down without a reason', async () => {
    const r = show();
    fireEvent.click(screen.getByRole('button', { name: 'Bad reply' }));
    await flush();
    rerender(r);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('group', { name: 'What went wrong?' })).toBeNull();
    expect(posted).toHaveLength(1);
    expect(useChatStore.getState().messages.a1.feedback).toEqual({ rating: 'down' });
  });

  it('a slow answer to an older press never covers a newer one', async () => {
    let release: (() => void) | null = null;
    const slow = new Promise<void>((res) => { release = res; });
    const fast = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (url, init) => { await slow; return fast(url as string, init); });
    const r = show();
    fireEvent.click(screen.getByRole('button', { name: 'Good reply' }));
    rerender(r);
    fireEvent.click(screen.getByRole('button', { name: 'Bad reply' }));
    await flush();
    expect(useChatStore.getState().messages.a1.feedback).toEqual({ rating: 'down' });
    release!();
    await flush();
    expect(useChatStore.getState().messages.a1.feedback).toEqual({ rating: 'down' });
  });

  it('a failed save puts the rating back and says so', async () => {
    fail = true;
    const r = show();
    fireEvent.click(screen.getByRole('button', { name: 'Good reply' }));
    await flush();
    rerender(r);
    expect(useChatStore.getState().messages.a1.feedback).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Couldn’t save that. Try again.');
  });

  it('not on a reply that is not saved yet, an error, or one being written', () => {
    useChatStore.setState({ messages: { u1: question, a1: reply({ local: true }) } });
    show();
    expect(screen.queryByRole('button', { name: 'Good reply' })).toBeNull();
    cleanup();
    useChatStore.setState({ messages: { u1: question, a1: reply({ error: { code: 'x', message: 'Failed', retryable: false } }) } });
    show();
    expect(screen.queryByRole('button', { name: 'Good reply' })).toBeNull();
    cleanup();
    useChatStore.setState({ messages: { u1: question, a1: reply() } });
    render(<AssistantMessage message={useChatStore.getState().messages.a1} live models={[]} />);
    expect(screen.queryByRole('button', { name: 'Good reply' })).toBeNull();
  });
});
