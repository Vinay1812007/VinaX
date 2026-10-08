import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRetry, failureFromResponse, failureMessage, needsEdit, pickIssueMessage, readPickIssue, runChatStream } from './streamClient';

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

describe('11.0 — refusals that asking again cannot change', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('tells a retired model, an oversized message and a refused request apart from a passing failure', () => {
    expect(failureFromResponse(400, 'unknown_model')).toBe('bad_model');
    expect(failureFromResponse(413, 'image_too_large')).toBe('too_large');
    expect(failureFromResponse(413, 'too_large')).toBe('too_large');
    expect(failureFromResponse(400, 'bad_request')).toBe('rejected');
    // Every engine rate-limited: 429 now, 500 from an older server. Other upstream failures: 502.
    expect(failureFromResponse(429, 'upstream')).toBe('busy');
    expect(failureFromResponse(500, 'exception')).toBe('unavailable');
    expect(failureFromResponse(502, 'upstream')).toBe('unavailable');
    expect(failureMessage('bad_model')).toBe('That model is no longer available — switched to Auto.');
    expect(failureMessage('too_large')).toContain('too large');
    expect(canRetry('bad_model')).toBe(true);
  });
  it.each([
    [400, 'unknown_model', 'bad_model'],
    [413, 'image_too_large', 'too_large'],
    [400, 'bad_request', 'rejected'],
  ] as const)('never re-sends a %i %s', async (status, error, failure) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error }), { status })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await runChatStream({ endpoint: '/api/vinaxai', body: {}, signal: new AbortController().signal, retryDelayMs: 0 });
    expect(res.failure).toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('needsEdit (11.0)', () => {
  it('is true only when the same message would be turned away again', () => {
    expect(needsEdit('too_large')).toBe(true);
    expect(needsEdit('rejected')).toBe(true);
    for (const f of ['bad_model', 'busy', 'offline', 'unavailable', 'disabled', 'over_budget', null] as const) expect(needsEdit(f)).toBe(false);
  });
});

describe('11.2 — model_unavailable: the pick gave no answer', () => {
  const body = {
    error: 'model_unavailable',
    reason: 'quota',
    model: { provider: 'gemini', id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    retryAfter: 3600,
    alternatives: [
      { provider: 'gemini', id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' },
      { provider: 'nvidia', id: 'x/y', name: 'Another provider' },
      { provider: 'gemini', id: 'bad slug!', name: 'Bad' },
      { provider: 'gemini', id: 'gemini-2.5-flash', name: 'Itself' },
    ],
  };
  afterEach(() => vi.unstubAllGlobals());

  it('is its own failure, never re-asked automatically, and Retry stays possible', async () => {
    expect(failureFromResponse(429, 'model_unavailable')).toBe('model_unavailable');
    expect(failureFromResponse(503, 'model_unavailable')).toBe('model_unavailable');
    expect(canRetry('model_unavailable')).toBe(true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await runChatStream({ endpoint: '/api/vinaxai', body: {}, signal: new AbortController().signal, retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.failure).toBe('model_unavailable');
    expect(r.pickIssue).toEqual({
      reason: 'quota',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      alternatives: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite' }],
    });
    expect(pickIssueMessage(r.pickIssue!)).toBe('Gemini 2.5 Flash has used up its free requests for today. Pick another model below, or try it again later.');
  });

  it('reads the stored (flat) copy back, and refuses junk', () => {
    const stored = readPickIssue(body);
    expect(readPickIssue(stored)).toEqual(stored);
    expect(readPickIssue({ reason: 'quota', model: { provider: 'acme', id: 'x' } })).toBeNull();
    expect(readPickIssue(null)).toBeNull();
    expect(readPickIssue({ reason: 'weird', provider: 'groq', model: 'a/b', name: 'AB' })?.reason).toBe('down');
  });
});
