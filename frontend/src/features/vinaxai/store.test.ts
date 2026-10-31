// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChat, sendMessage, stopReply, useChatStore } from './store';

beforeEach(() => resetChat());
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
