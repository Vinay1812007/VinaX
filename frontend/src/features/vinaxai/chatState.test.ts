import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat, LOCAL_REPLY, LOCAL_USER, parentForNext, pathTo, type ChatAction, type ChatState } from './chatState';
import type { StreamEvent } from './types';

const run = (actions: ChatAction[], from: ChatState = initialChat()): ChatState => actions.reduce(chatReducer, from);
const ev = (e: StreamEvent, now = 1_000): ChatAction => ({ type: 'stream', ev: e, now });
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const meta = (over: Partial<{ conversationId: string; userMessageId: string; assistantMessageId: string; model: typeof MODEL }> = {}) =>
  ev({ event: 'meta', data: { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL, ...over } });
const send = (text = 'hi', parentId: string | null = null): ChatAction => ({ type: 'send', text, parentId, now: '2026-10-30T10:00:00Z' });
const thread = (s: ChatState) => pathTo(s.messages, s.leafId);

describe('chatReducer: a reply streaming in', () => {
  it('send adds the question and an empty reply; meta names them', () => {
    let s = run([send('What is a raga?')]);
    expect(s.streaming).toBe(true);
    expect(thread(s).map((m) => m.id)).toEqual([LOCAL_USER, LOCAL_REPLY]);
    s = run([meta()], s);
    expect(s.conversationId).toBe('c1');
    expect(thread(s).map((m) => [m.id, m.parentId])).toEqual([['u1', null], ['a1', 'u1']]);
    expect(s.messages.a1.model).toEqual(MODEL);
    expect(s.replyId).toBe('a1');
  });

  it('title, thinking then text; the thinking time is measured when the answer starts', () => {
    const s = run([
      send(), meta(),
      ev({ event: 'title', data: { title: 'Ragas' } }),
      ev({ event: 'thinking', data: { delta: 'Let me ' } }, 1_000),
      ev({ event: 'thinking', data: { delta: 'think.' } }, 2_000),
      ev({ event: 'text', data: { delta: 'A raga ' } }, 13_000),
      ev({ event: 'text', data: { delta: 'is…' } }, 14_000),
      ev({ event: 'done', data: { stopReason: 'end' } }),
    ]);
    expect(s.title).toBe('Ragas');
    expect(s.messages.a1).toMatchObject({ thinking: 'Let me think.', text: 'A raga is…', thinkingMs: 12_000, stopReason: 'end', local: false });
    expect(s.streaming).toBe(false);
    expect(s.finished).toBe(1);
  });

  it('a failover (a second meta with another model) clears the first model’s thinking', () => {
    const s = run([send(), meta(), ev({ event: 'thinking', data: { delta: 'first' } }), meta({ model: { id: 'gemini:x', name: 'Gemini', provider: 'Google Gemini' } })]);
    expect(s.messages.a1).toMatchObject({ thinking: '', model: { id: 'gemini:x' } });
  });

  it('an error event is kept on the reply, with what was written', () => {
    const s = run([send(), meta(), ev({ event: 'text', data: { delta: 'Half' } }), ev({ event: 'error', data: { code: 'model_busy', message: 'Busy.', retryable: true } }), ev({ event: 'done', data: { stopReason: 'error' } })]);
    expect(s.messages.a1).toMatchObject({ text: 'Half', stopReason: 'error', error: { code: 'model_busy' } });
  });

  it('done with no text and no error becomes an empty-reply error', () => {
    const s = run([send(), meta(), ev({ event: 'done', data: { stopReason: 'end' } })]);
    expect(s.messages.a1.error?.code).toBe('empty_reply');
  });

  it('stopping before anything arrived drops the reply; stopping later keeps the partial text', () => {
    let s = run([send(), meta(), { type: 'stopped' }]);
    expect(s.messages.a1).toBeUndefined();
    expect(s.leafId).toBe('u1');
    s = run([send(), meta(), ev({ event: 'text', data: { delta: 'Part' } }), { type: 'stopped' }]);
    expect(s.messages.a1).toMatchObject({ text: 'Part', stopReason: 'aborted' });
  });

  it('stopping before the server named the messages takes the question back too', () => {
    const base = run([send('one'), meta(), ev({ event: 'text', data: { delta: 'r' } }), ev({ event: 'done', data: { stopReason: 'end' } })]);
    const s = run([send('two', 'a1'), { type: 'stopped' }], base);
    expect(thread(s).map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(s.messages[LOCAL_USER]).toBeUndefined();
    expect(s.streaming).toBe(false);
    expect(s.notice).toBeNull();
  });

  it('a request refused before the stream undoes the optimistic messages and shows a notice', () => {
    const base = run([send('one'), meta(), ev({ event: 'text', data: { delta: 'r' } }), ev({ event: 'done', data: { stopReason: 'end' } })]);
    const s = run([send('two', 'a1'), { type: 'fail', code: 'ai_disabled', message: 'Taking a break.' }], base);
    expect(thread(s).map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(s.notice).toEqual({ code: 'ai_disabled', message: 'Taking a break.' });
    expect(s.streaming).toBe(false);
  });

  it('ignores a second send while streaming', () => {
    const s = run([send('one'), send('two')]);
    expect(Object.keys(s.messages)).toHaveLength(2);
  });
});

describe('chatReducer: retry, load and branches', () => {
  const loaded = run([{
    type: 'load',
    conversation: { id: 'c1', title: 'Ragas', starred: false, activeLeafId: 'a1', createdAt: '', updatedAt: '' },
    messages: [
      { id: 'u1', parentId: null, role: 'user', content: [{ type: 'text', text: 'q' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: '1' },
      { id: 'a1', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: 'r1' }], thinking: 'hm', thinkingMs: 3000, model: MODEL, stopReason: 'end', createdAt: '2' },
      { id: 'a0', parentId: 'u1', role: 'assistant', content: [{ type: 'text', text: 'older' }], thinking: null, thinkingMs: null, model: null, stopReason: 'end', createdAt: '0' },
    ],
  }]);

  it('load opens the saved branch', () => {
    expect(loaded.conversationId).toBe('c1');
    expect(thread(loaded).map((m) => m.text)).toEqual(['q', 'r1']);
    expect(loaded.messages.a1.thinkingMs).toBe(3000);
  });

  it('retry adds a sibling reply under the same question', () => {
    const s = run([{ type: 'retry', userId: 'u1', now: '3' }, ev({ event: 'meta', data: { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a2', model: MODEL } }), ev({ event: 'text', data: { delta: 'r2' } }), ev({ event: 'done', data: { stopReason: 'end' } })], loaded);
    expect(thread(s).map((m) => m.id)).toEqual(['u1', 'a2']);
    expect(Object.values(s.messages).filter((m) => m.parentId === 'u1').map((m) => m.id).sort()).toEqual(['a0', 'a1', 'a2']);
  });

  it('a new message after a failed (unsaved) reply hangs under the question, not the failure', () => {
    const failed = run([send('q2', 'a1'), meta({ userMessageId: 'u2', assistantMessageId: 'a3' }), ev({ event: 'error', data: { code: 'all_busy', message: 'Busy', retryable: true } }), ev({ event: 'done', data: { stopReason: 'error' } })], loaded);
    expect(failed.messages.a3.local).toBe(true);
    expect(parentForNext(failed)).toBe('u2');
    const next = run([send('q3', parentForNext(failed))], failed);
    expect(next.messages.a3).toBeUndefined(); // the failed placeholder is tidied away
  });
});

describe('chatReducer: continue and branches', () => {
  const MODEL2 = { id: 'gemini:g', name: 'Gemini', provider: 'Google Gemini' };
  const base = () => run([send('q'), meta(), ev({ event: 'text', data: { delta: 'A melodic fra' } }), ev({ event: 'done', data: { stopReason: 'length' } })]);

  it('Continue appends to the same reply and clears its cut-off state', () => {
    const s = run([
      { type: 'continue', messageId: 'a1' },
      ev({ event: 'meta', data: { conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL2, continued: true } }),
      ev({ event: 'text', data: { delta: 'mework.' } }),
      ev({ event: 'done', data: { stopReason: 'end' } }),
    ], base());
    expect(s.messages.a1).toMatchObject({ text: 'A melodic framework.', stopReason: 'end', model: MODEL2 });
    expect(Object.keys(s.messages)).toHaveLength(2);
    expect(s.resume).toBeNull();
  });

  it('a refused Continue, or one stopped before any text, leaves the reply as it was', () => {
    let s = run([{ type: 'continue', messageId: 'a1' }, { type: 'fail', code: 'rate_limited', message: 'Wait.' }], base());
    expect(s.messages.a1).toMatchObject({ text: 'A melodic fra', stopReason: 'length' });
    expect(s.notice?.code).toBe('rate_limited');
    s = run([{ type: 'continue', messageId: 'a1' }, { type: 'stopped' }], base());
    expect(s.messages.a1).toMatchObject({ text: 'A melodic fra', stopReason: 'length' });
  });

  it('siblings, leafUnder and select-leaf follow the tree', async () => {
    const { siblingsOf, leafUnder } = await import('./chatState');
    const m = (id: string, parentId: string | null, role: 'user' | 'assistant', at: string) => ({ id, parentId, role, text: id, thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: at });
    const messages = { u1: m('u1', null, 'user', '1'), a1: m('a1', 'u1', 'assistant', '2'), u2: m('u2', null, 'user', '3'), a2: m('a2', 'u2', 'assistant', '4'), a3: m('a3', 'u2', 'assistant', '5') };
    expect(siblingsOf(messages, messages.u2).map((x) => x.id)).toEqual(['u1', 'u2']);
    expect(siblingsOf(messages, messages.a2).map((x) => x.id)).toEqual(['a2', 'a3']);
    expect(leafUnder(messages, 'u2')).toBe('a3');
    expect(leafUnder(messages, 'u1')).toBe('a1');
    const s = run([{ type: 'select-leaf', leafId: 'a1' }], { ...initialChat(), messages, leafId: 'a3' });
    expect(thread(s).map((x) => x.id)).toEqual(['u1', 'a1']);
  });
});

describe('chatReducer: web search', () => {
  const src = { n: 1, url: 'https://a.com', title: 'A', site: 'a.com' };
  it('keeps the search status while writing and clears it when done', () => {
    let s = run([send(), meta(), ev({ event: 'status', data: { step: 'searching', query: 'q' } })]);
    expect(s.messages.a1.status).toEqual({ step: 'searching', query: 'q' });
    s = run([ev({ event: 'text', data: { delta: 'x' } }), ev({ event: 'done', data: { stopReason: 'end' } })], s);
    expect(s.messages.a1.status).toBeNull();
  });
  it('search sources arrive before the text and stay with the reply', () => {
    const s = run([send(), meta(), ev({ event: 'sources', data: { items: [src], via: 'search' } }), ev({ event: 'text', data: { delta: 'Done [1]' } }), ev({ event: 'done', data: { stopReason: 'end' } })]);
    expect(s.messages.a1).toMatchObject({ text: 'Done [1]', sources: { items: [src], via: 'search' } });
  });
  it('grounding markers are written into the text', () => {
    const s = run([send(), meta(), ev({ event: 'text', data: { delta: 'India won. Next.' } }), ev({ event: 'sources', data: { items: [src], via: 'grounding', markers: [{ at: 10, ns: [1] }, { at: 16, ns: [1] }] } })]);
    expect(s.messages.a1.text).toBe('India won.[1] Next.[1]');
    expect(s.messages.a1.sources).not.toHaveProperty('markers');
  });
  it('a loaded reply keeps its sources', () => {
    const s = run([{ type: 'load', conversation: { id: 'c', title: 't', starred: false, activeLeafId: 'a', createdAt: '', updatedAt: '' }, messages: [{ id: 'a', parentId: null, role: 'assistant', content: [{ type: 'text', text: 'x[1]' }], thinking: null, thinkingMs: null, model: null, stopReason: 'end', sources: { items: [src], via: 'search' }, createdAt: '1' }] }]);
    expect(s.messages.a.sources?.items).toEqual([src]);
  });
});

describe('chatReducer: files', () => {
  const file = { id: 'f1', name: 'a.png', kind: 'image' as const, mime: 'image/png', size: 10, preview: 'blob:x' };
  it('a sent message keeps its files; a loaded one reads them from its content', () => {
    const s = run([{ type: 'send', text: '', parentId: null, now: '1', files: [file] }, meta()]);
    expect(s.messages.u1.files).toEqual([file]);
    const loaded = run([{ type: 'load', conversation: { id: 'c', title: 't', starred: false, activeLeafId: 'u', createdAt: '', updatedAt: '' }, messages: [{ id: 'u', parentId: null, role: 'user', content: [{ type: 'attachment', id: 'f1', name: 'a.png', kind: 'image', mime: 'image/png', size: 10 }, { type: 'text', text: 'what is it' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: '1' }] }]);
    expect(loaded.messages.u).toMatchObject({ text: 'what is it', files: [{ id: 'f1', name: 'a.png', kind: 'image' }] });
  });
});
