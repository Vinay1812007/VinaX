// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_CONTINUES, continueReply, resetChat, retryReply, sendMessage, stopReply, useChatStore } from './store';
import { usePrefs } from './prefs';

beforeEach(() => {
  resetChat();
  usePrefs.setState({ model: 'auto', extendedThinking: false, webSearch: 'auto', artifacts: true, personalName: '', personalAbout: '', personalInstructions: '', style: 'normal' });
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

  it('sends the Personalisation settings and the Artifacts switch with each message, and nothing when they are unset', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const ok = sse([['meta', { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'm', name: 'M', provider: 'P' } }], ['done', { stopReason: 'end' }]]);
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(ok, { status: 200 }); }));
    await sendMessage('Hi');
    expect(bodies[0].personal).toBeUndefined();
    expect(bodies[0].artifacts).toBe(true);
    resetChat();
    usePrefs.setState({ personalName: ' Ash ', personalAbout: 'I play the sitar.', personalInstructions: '', style: 'concise', artifacts: false });
    await sendMessage('Hi again');
    expect(bodies[1].personal).toEqual({ name: 'Ash', about: 'I play the sitar.', style: 'concise' });
    expect(bodies[1].artifacts).toBe(false);
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

describe('a reply cut off inside an artifact', () => {
  const meta = { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'm', name: 'M', provider: 'P' } };
  const stub = (replies: string[]): Array<Record<string, unknown>> => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(replies[Math.min(bodies.length - 1, replies.length - 1)], { status: 200 });
    }));
    return bodies;
  };

  it('carries on by itself until the artifact is finished', async () => {
    const bodies = stub([
      sse([['meta', meta], ['text', { delta: 'Here it is.\n<artifact id="app" type="html" title="App"><html><body>' }], ['done', { stopReason: 'length', saved: true }]]),
      sse([['meta', { ...meta, continued: true }], ['text', { delta: '<p>Hi</p></body></html>\n</artifact>\nDone.' }], ['done', { stopReason: 'end', saved: true }]]),
    ]);
    await expect(sendMessage('Build an app')).resolves.toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ conversationId: 'c1', continueFrom: 'a1', content: [] });
    expect(useChatStore.getState().messages.a1.text).toContain('</artifact>');
  });

  it('a reply too big for the Worker to save is saved from the page first, then carried on; the Continue is saved whole', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const replies = [
      sse([['meta', meta], ['text', { delta: '<artifact id="app" type="html" title="App"><html>' }], ['done', { stopReason: 'length', saved: false }]]),
      sse([['meta', { ...meta, continued: true }], ['text', { delta: '<body>Hi</body></html>\n</artifact>' }], ['done', { stopReason: 'end', saved: false }]]),
    ];
    let chat = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url.endsWith('/keep')) return new Response(JSON.stringify({ ok: true, saved: true }), { status: 200 });
      return new Response(replies[chat++], { status: 200 });
    }));
    await sendMessage('Build an app');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['chat', 'keep', 'chat', 'keep']);
    expect(calls[1].body).toMatchObject({ assistantMessageId: 'a1', stopReason: 'length', text: '<artifact id="app" type="html" title="App"><html>' });
    expect(calls[1].body.continued).toBeUndefined();
    expect(calls[2].body).toMatchObject({ continueFrom: 'a1' });
    expect(calls[3].body).toMatchObject({ assistantMessageId: 'a1', stopReason: 'end', continued: true });
    expect(String(calls[3].body.text)).toContain('</artifact>');
  });

  it('stops after three tries, and never for a cut-off reply with no open artifact', async () => {
    const cut = sse([['meta', meta], ['text', { delta: '<artifact id="app" type="html" title="App"><html>' }], ['done', { stopReason: 'length', saved: true }]]);
    const bodies = stub([cut]);
    await sendMessage('Build an app');
    expect(bodies).toHaveLength(1 + AUTO_CONTINUES);
    resetChat();
    const plain = stub([sse([['meta', meta], ['text', { delta: 'A long essay…' }], ['done', { stopReason: 'length', saved: true }]])]);
    await sendMessage('Write an essay');
    expect(plain).toHaveLength(1);
  });
});

describe('pass-through streams (the provider\'s own lines)', () => {
  const META = { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: { id: 'nvidia:x', name: 'X', provider: 'NVIDIA' }, wire: 'openai' };
  const line = (delta: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
  type Call = { url: string; body: Record<string, unknown> };
  const stub = (answers: string[]): Call[] => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url.endsWith('/keep')) return new Response(JSON.stringify({ ok: true, saved: true }), { status: 200 });
      return new Response(answers.shift() ?? '', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    return calls;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('reads thinking and text out of the raw lines and asks for pass-through', async () => {
    const calls = stub([sse([['meta', META]]) + line({ reasoning_content: 'Plan.' }) + line({ content: 'Kafka ' }) + line({ content: 'rocks.' }) + 'data: [DONE]\n\n\n\n' + sse([['done', { stopReason: 'end', saved: true }]])]);
    await expect(sendMessage('Explain Kafka')).resolves.toEqual({ ok: true });
    expect(useChatStore.getState().messages.a1).toMatchObject({ text: 'Kafka rocks.', thinking: 'Plan.', stopReason: 'end' });
    expect(calls[0].body.passthrough).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/keep'))).toBe(false);
  });

  it('a stream cut off before any answer text asks once more by itself, for the same question', async () => {
    const calls = stub([
      sse([['meta', META]]) + line({ reasoning_content: 'Thinking hard' }),
      sse([['meta', { ...META, assistantMessageId: 'a2' }]]) + line({ content: 'Second try.' }) + sse([['done', { stopReason: 'end', saved: true }]]),
    ]);
    await expect(sendMessage('Explain Kafka')).resolves.toEqual({ ok: true });
    const chats = calls.filter((c) => c.url.endsWith('/chat'));
    expect(chats).toHaveLength(2);
    expect(chats[1].body).toMatchObject({ conversationId: 'c1', parentMessageId: 'u1', content: [] });
    const s = useChatStore.getState();
    expect(s.messages.a2).toMatchObject({ text: 'Second try.', stopReason: 'end' });
    expect(s.messages.a1).toBeUndefined();
    expect(Object.values(s.messages).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('asks again only once: a second cut-off shows the error', async () => {
    const cut = sse([['meta', META]]) + line({ reasoning_content: 'Thinking' });
    const calls = stub([cut, cut]);
    await expect(sendMessage('Explain Kafka')).resolves.toMatchObject({ ok: false, beforeStart: false });
    expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(2);
    expect(useChatStore.getState().messages.a1?.error).toMatchObject({ message: 'The connection dropped before the reply finished.' });
  });

  it('a stream cut off after some text keeps it on screen and saves it (POST /api/ai/keep)', async () => {
    const calls = stub([sse([['meta', META]]) + line({ content: 'Half an ans' })]);
    await expect(sendMessage('Explain Kafka')).resolves.toMatchObject({ ok: false });
    await settle();
    expect(useChatStore.getState().messages.a1).toMatchObject({ text: 'Half an ans', stopReason: 'error' });
    const keep = calls.find((c) => c.url.endsWith('/keep'));
    expect(keep?.body).toEqual({ conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', text: 'Half an ans', model: 'nvidia:x', stopReason: 'error' });
  });

  it('done with saved false (the Worker could not save it) keeps the text too', async () => {
    const calls = stub([sse([['meta', META]]) + line({ content: 'Partial' }) + sse([['error', { code: 'model_timeout', message: 'X took too long to answer.', retryable: true }], ['done', { stopReason: 'error', saved: false }]])]);
    await sendMessage('Explain Kafka');
    await settle();
    expect(calls.find((c) => c.url.endsWith('/keep'))?.body).toMatchObject({ assistantMessageId: 'a1', text: 'Partial', stopReason: 'error' });
  });

  it('Stop after some text saves what was shown, as aborted', async () => {
    const enc = new TextEncoder();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (url.endsWith('/keep')) return new Response('{"ok":true,"saved":true}', { status: 200 });
      return new Response(new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(sse([['meta', META]]) + line({ content: 'So far' })));
          init.signal?.addEventListener('abort', () => c.error(new DOMException('Stopped', 'AbortError')));
        },
      }), { status: 200 });
    }));
    const pending = sendMessage('Explain Kafka');
    for (let i = 0; i < 50 && !useChatStore.getState().messages.a1?.text; i++) await new Promise((r) => setTimeout(r, 5));
    stopReply();
    await pending;
    await settle();
    expect(calls.find((c) => c.url.endsWith('/keep'))?.body).toMatchObject({ text: 'So far', stopReason: 'aborted' });
  });

  it('sending the same question again after it went unanswered asks for a new answer, not a second copy', async () => {
    const calls = stub([sse([['meta', { ...META, assistantMessageId: 'a9' }]]) + line({ content: 'Answer.' }) + sse([['done', { stopReason: 'end', saved: true }]])]);
    useChatStore.setState({ conversationId: 'c1', messages: { u1: { id: 'u1', parentId: null, role: 'user', text: 'Explain Kafka', thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: '1' } }, leafId: 'u1' });
    await sendMessage(' Explain Kafka ');
    expect(calls[0].body).toMatchObject({ conversationId: 'c1', parentMessageId: 'u1', content: [] });
    expect(Object.values(useChatStore.getState().messages).filter((m) => m.role === 'user')).toHaveLength(1);
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
