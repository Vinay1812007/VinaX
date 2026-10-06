import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRetry, failureFromResponse, failureMessage, runChatStream } from './streamClient';

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
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(sse(['data: {"meta":{"model":"m"}}\n\ndata: {"del', 'ta":"Hi"}\n\n', 'data: {"delta":" there"}\n\ndata: {"done":true,"truncated":true}\n\n']))));
    const deltas: string[] = [];
    const updates: string[] = [];
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, onDelta: (d) => deltas.push(d), onUpdate: (s) => updates.push(s.text) });
    expect(out.failure).toBeNull();
    expect(out.state).toMatchObject({ text: 'Hi there', model: 'm', truncated: true, done: true });
    expect(deltas).toEqual(['Hi', ' there']);
    expect(updates[updates.length - 1]).toBe('Hi there');
  });

  it('reports a throttled or failed request without throwing (after its one re-ask)', async () => {
    const busy = vi.fn(() => Promise.resolve(new Response('{}', { status: 429 })));
    vi.stubGlobal('fetch', busy);
    expect((await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, retryDelayMs: 0 })).failure).toBe('busy');
    expect(busy).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, retryDelayMs: 0 });
    expect(out).toMatchObject({ failure: 'unavailable', aborted: false, retries: 1 });
    expect(failureMessage(out.failure)).toMatch(/try again/);
    expect(canRetry(out.failure)).toBe(true);
  });

  it('8.2.0 — a transient failure is asked once more, and the second answer is what the listener sees', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"engine_unreachable"}', { status: 503 }))
      .mockResolvedValueOnce(sse(['data: {"delta":"Back again"}\n\ndata: {"done":true}\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const onRetry = vi.fn();
    const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, retryDelayMs: 0, onRetry });
    expect(out).toMatchObject({ failure: null, retries: 1 });
    expect(out.state.text).toBe('Back again');
    expect(onRetry).toHaveBeenCalledWith('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('8.2.0 — switched off or over its limit: told apart, never re-asked, no Retry', async () => {
    for (const [code, failure] of [['ai_disabled', 'disabled'], ['ai_not_configured', 'disabled'], ['ai_over_budget', 'over_budget']] as const) {
      const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: code }), { status: 503 })));
      vi.stubGlobal('fetch', fetchMock);
      const out = await runChatStream({ endpoint: '/x', body: {}, signal: new AbortController().signal, retryDelayMs: 0 });
      expect(out.failure).toBe(failure);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(canRetry(out.failure)).toBe(false);
    }
    expect(failureMessage('disabled')).toMatch(/switched off/);
    expect(failureMessage('over_budget')).toMatch(/limit for today/);
    expect(failureFromResponse(503, 'engine_unreachable')).toBe('unavailable');
  });

  it('8.2.0 — Stop during the pause before the re-ask is a stop, not a failure', async () => {
    const ctl = new AbortController();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    const pending = runChatStream({ endpoint: '/x', body: {}, signal: ctl.signal, retryDelayMs: 60_000 });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    expect(await pending).toMatchObject({ failure: null, aborted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
