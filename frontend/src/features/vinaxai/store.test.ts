// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { continueReply, resetChat, retryReply, sendMessage, stopReply, useChatStore } from './store';
import { usePrefs } from './prefs';

beforeEach(() => {
  resetChat();
  usePrefs.setState({ model: 'auto', extendedThinking: false, webSearch: 'auto' });
});
afterEach(() => vi.unstubAllGlobals());

const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

describe('the chat controller', () => {
  it('Stop works at once even when the request never answers, and hands the text back', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const pending = sendMessage('A slow question');
    expect(useChatStore.getState().streaming).toBe(true);
    stopReply();
    await expect(pending).resolves.toEqual({ ok: false, code: 'aborted', beforeStart: true });
    expect(useChatStore.getState().streaming).toBe(false);
    expect(Object.keys(useChatStore.getState().messages)).toEqual([]);
  });

  it('streams a reply into the store', async () => {
    const body = sse([
      ['meta', { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'm', name: 'M', provider: 'P' } }],
      ['text', { delta: 'Hello' }],
      ['done', { stopReason: 'end' }],
    ]);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    await expect(sendMessage('Hi')).resolves.toEqual({ ok: true });
    const s = useChatStore.getState();
    expect(s.conversationId).toBe('c1');
    expect(s.messages.a1).toMatchObject({ text: 'Hello', stopReason: 'end' });
    expect(calls[0].url).toBe('/api/ai/chat');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ conversationId: null, mode: 'auto', content: [{ type: 'text', text: 'Hi' }] });
  });

  it('a refused request hands the text back and leaves a notice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'ai_disabled' }), { status: 503 })));
    await expect(sendMessage('Hi')).resolves.toEqual({ ok: false, code: 'ai_disabled', beforeStart: true });
    expect(useChatStore.getState().notice?.code).toBe('ai_disabled');
  });

  it('a stream that breaks after it began keeps the reply with an error', async () => {
    const body = sse([['meta', { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'm', name: 'M', provider: 'P' } }], ['text', { delta: 'Half' }]]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    await expect(sendMessage('Hi')).resolves.toMatchObject({ ok: false, beforeStart: false });
    expect(useChatStore.getState().messages.a1).toMatchObject({ text: 'Half', stopReason: 'error', error: { retryable: true } });
  });
});

describe('what the controller asks for', () => {
  const ok = sse([['meta', { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a2', model: { id: 'm', name: 'M', provider: 'P' } }], ['text', { delta: 'x' }], ['done', { stopReason: 'end' }]]);
  const bodies: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(ok, { status: 200 }); }));
    useChatStore.setState({ conversationId: 'c1', messages: { u1: { id: 'u1', parentId: null, role: 'user', text: 'q', thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: '1' }, a1: { id: 'a1', parentId: 'u1', role: 'assistant', text: 'cut', thinking: '', thinkingMs: null, model: null, stopReason: 'length', error: null, createdAt: '2' } }, leafId: 'a1' });
  });

  it('the composer model and Extended thinking go with every message', async () => {
    usePrefs.setState({ model: 'groq:openai/gpt-oss-120b', extendedThinking: true, webSearch: 'on' });
    await sendMessage('hello');
    expect(bodies[0]).toMatchObject({ conversationId: 'c1', parentMessageId: 'a1', mode: 'model', model: 'groq:openai/gpt-oss-120b', extendedThinking: true, webSearch: 'on' });
  });

  it('files go first in the content; a message may be files alone', async () => {
    await sendMessage('', { files: [{ id: 'f1', name: 'a.png', kind: 'image', mime: 'image/png', size: 1 }] });
    expect(bodies[0]).toMatchObject({ content: [{ type: 'attachment', id: 'f1' }] });
  });

  it('an edit of the first message is sent as a new root', async () => {
    await sendMessage('better', { parentId: null });
    expect(bodies[0]).toMatchObject({ parentMessageId: 'root', content: [{ type: 'text', text: 'better' }] });
  });

  it('Retry with a model overrides the composer; Continue sends continueFrom', async () => {
    await retryReply('u1', { mode: 'auto' });
    expect(bodies[0]).toMatchObject({ parentMessageId: 'u1', content: [], mode: 'auto' });
    useChatStore.setState({ leafId: 'a1' });
    await continueReply('a1');
    expect(bodies[1]).toMatchObject({ continueFrom: 'a1', content: [] });
  });
});
