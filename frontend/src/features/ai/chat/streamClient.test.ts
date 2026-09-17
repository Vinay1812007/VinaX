import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureMessage, runChatStream } from './streamClient';

const sse = (chunks: string[], status = 200): Response => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
};

afterEach(() => vi.unstubAllGlobals());

describe('runChatStream', () => {
  it('folds a stream whose frames are split across network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(sse(['data: {"meta":{"model":"m","sources":[]}}\n\ndata: {"del', 'ta":"Hi"}\n\ndata: {"step":{"tool":"code","label":"Ran code"}}\n\n', 'data: {"delta":" there"}\n\ndata: {"done":true,"truncated":true}\n\n']))));
    const deltas: string[] = [];
    const updates: string[] = [];
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, onDelta: (d) => deltas.push(d), onUpdate: (s) => updates.push(s.text) });
    expect(out.failure).toBeNull();
    expect(out.state).toMatchObject({ text: 'Hi there', model: 'm', truncated: true, done: true, steps: [{ tool: 'code', label: 'Ran code' }] });
    expect(deltas).toEqual(['Hi', ' there']);
    expect(updates[updates.length - 1]).toBe('Hi there');
  });

  it('reports a throttled or failed request without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 429 }))));
    expect((await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal })).failure).toBe('busy');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal });
    expect(out).toMatchObject({ failure: 'unavailable', aborted: false });
    expect(failureMessage(out.failure)).toMatch(/try again/);
  });

  it('never calls the network while the device is offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: false });
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal });
    expect(out.failure).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failureMessage('offline')).toMatch(/offline/i);
  });

  it('treats Stop as a stop, not a failure', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('fetch', vi.fn(() => { ctl.abort(); return Promise.reject(new DOMException('aborted', 'AbortError')); }));
    expect(await runChatStream({ endpoint: '/x', body: {}, signal: ctl.signal })).toMatchObject({ failure: null, aborted: true });
  });
});
