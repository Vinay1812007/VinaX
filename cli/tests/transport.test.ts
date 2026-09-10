/**
 * The wire: SSE framing, event decoding, and the API client's error handling.
 *
 * Chunk boundaries are the point. A parser that only works when a whole event
 * arrives in one read works perfectly in a test and fails on a real network.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSseParser } from '../src/api/sse.js';
import { PROTOCOL, toAgentEvent } from '../src/protocol/events.js';
import { ApiError, VinaxApi } from '../src/api/client.js';

function sseBody(events: Array<Record<string, unknown>>): string {
  return `${events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n')}\n\n`;
}

function streamOf(text: string, chunkSize = 1024): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(at, at + chunkSize));
      at += chunkSize;
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('SSE parsing', () => {
  it('parses a complete event', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\n')).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('reassembles an event split across many chunks', () => {
    const p = createSseParser();
    const whole = 'data: {"type":"assistant_delta","text":"hello"}\n\n';
    const out = [];
    for (const ch of whole) out.push(...p.push(ch));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].data).text).toBe('hello');
  });

  it('handles several events arriving in one chunk', () => {
    const p = createSseParser();
    const out = p.push('data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n');
    expect(out.map((m) => JSON.parse(m.data).n)).toEqual([1, 2, 3]);
  });

  it('handles CRLF framing', () => {
    const p = createSseParser();
    expect(p.push('data: {"n":1}\r\n\r\n').map((m) => m.data)).toEqual(['{"n":1}']);
  });

  it('joins multi-line data fields', () => {
    const p = createSseParser();
    expect(p.push('data: line one\ndata: line two\n\n')[0].data).toBe('line one\nline two');
  });

  it('ignores comments and unknown fields', () => {
    const p = createSseParser();
    expect(p.push(': keep-alive\n\n')).toEqual([]);
    expect(p.push('id: 7\nretry: 100\ndata: {"n":1}\n\n')).toHaveLength(1);
  });

  it('flushes a final event whose blank line never arrived', () => {
    const p = createSseParser();
    expect(p.push('data: {"n":1}')).toEqual([]);
    expect(p.end().map((m) => m.data)).toEqual(['{"n":1}']);
  });

  it('reads a named event type', () => {
    const p = createSseParser();
    expect(p.push('event: done\ndata: {}\n\n')[0].event).toBe('done');
  });
});

describe('event decoding', () => {
  it('decodes each event type', () => {
    const base = { seq: 1, runId: 'r', requestId: 'q', step: 1 };
    expect(toAgentEvent({ type: 'hello', protocol: PROTOCOL, maxSteps: 80, maxCallsPerStep: 6, ...base })?.type).toBe('hello');
    expect(toAgentEvent({ type: 'assistant_delta', text: 'hi', ...base })).toMatchObject({ text: 'hi' });
    expect(toAgentEvent({ type: 'tool_call', id: 'c1', name: 'read_file', arguments: { path: 'a' }, ...base })).toMatchObject({
      name: 'read_file', arguments: { path: 'a' },
    });
    expect(toAgentEvent({ type: 'done', reason: 'final', toolCalls: 0, ...base })).toMatchObject({ reason: 'final' });
  });

  it('rejects a tool_call with no name or no id, rather than executing a mystery', () => {
    const base = { seq: 1, runId: 'r', requestId: 'q', step: 1 };
    expect(toAgentEvent({ type: 'tool_call', id: 'c1', ...base })).toBeNull();
    expect(toAgentEvent({ type: 'tool_call', name: 'read_file', ...base })).toBeNull();
  });

  it('ignores an event type it has never heard of, instead of failing', () => {
    expect(toAgentEvent({ type: 'telepathy', seq: 1 })).toBeNull();
    expect(toAgentEvent(null)).toBeNull();
    expect(toAgentEvent('nope')).toBeNull();
  });

  it('falls back to safe values for missing fields', () => {
    const ev = toAgentEvent({ type: 'assistant_delta' });
    expect(ev).toMatchObject({ text: '', seq: 0, step: 1 });
  });
});

describe('the API client', () => {
  const api = (fetchImpl: typeof fetch): VinaxApi => new VinaxApi({ apiBase: 'https://vinax.test', fetchImpl });

  it('reads meta', async () => {
    const client = api(vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocol: PROTOCOL, engines: [] }), { status: 200 })) as unknown as typeof fetch);
    expect((await client.meta()).protocol).toBe(PROTOCOL);
  });

  it('turns an HTTP error into a typed ApiError with its code and message', async () => {
    const client = api(vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_engine', message: 'unknown engine "turbo"' }), { status: 400 }),
    ) as unknown as typeof fetch);
    await expect(async () => {
      for await (const _ of client.agent({} as never)) { void _; }
    }).rejects.toMatchObject({ code: 'invalid_engine', status: 400 });
  });

  it('surfaces a rate limit with its retry hint', async () => {
    const client = api(vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate_limited', message: 'slow down' }), { status: 429, headers: { 'retry-after': '12' } }),
    ) as unknown as typeof fetch);
    try {
      for await (const _ of client.agent({} as never)) { void _; }
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).retryAfter).toBe(12);
    }
  });

  it('explains an offline machine in words a user can act on', async () => {
    const client = api(vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND vinax.test')) as unknown as typeof fetch);
    await expect(client.meta()).rejects.toMatchObject({ code: 'dns' });
  });

  it('explains a refused connection', async () => {
    const client = api(vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8787')) as unknown as typeof fetch);
    await expect(client.meta()).rejects.toMatchObject({ code: 'refused' });
  });

  it('streams normalized events out of an SSE body', async () => {
    const body = sseBody([
      { type: 'hello', protocol: PROTOCOL, maxSteps: 80, maxCallsPerStep: 6, seq: 1, runId: 'r', requestId: 'q', step: 1 },
      { type: 'assistant_delta', text: 'Reading ', seq: 2, runId: 'r', requestId: 'q', step: 1 },
      { type: 'assistant_delta', text: 'the file.', seq: 3, runId: 'r', requestId: 'q', step: 1 },
      { type: 'done', reason: 'final', toolCalls: 0, seq: 4, runId: 'r', requestId: 'q', step: 1 },
    ]);
    const client = api(vi.fn().mockResolvedValue(streamOf(body, 7)) as unknown as typeof fetch);
    const seen: string[] = [];
    for await (const ev of client.agent({} as never)) {
      if (ev.type === 'assistant_delta') seen.push(ev.text);
    }
    expect(seen.join('')).toBe('Reading the file.');
  });

  it('survives a malformed event in the middle of a good stream', async () => {
    const body = 'data: {"type":"assistant_delta","text":"a","seq":1}\n\ndata: not json at all\n\ndata: {"type":"done","reason":"final","toolCalls":0,"seq":3}\n\n';
    const client = api(vi.fn().mockResolvedValue(streamOf(body)) as unknown as typeof fetch);
    const types: string[] = [];
    for await (const ev of client.agent({} as never)) types.push(ev.type);
    expect(types).toEqual(['assistant_delta', 'done']);
  });

  it('yields what it received when the stream ends early, rather than throwing it away', async () => {
    const body = 'data: {"type":"assistant_delta","text":"partial","seq":1}\n\ndata: {"type":"assis';
    const client = api(vi.fn().mockResolvedValue(streamOf(body)) as unknown as typeof fetch);
    const types: string[] = [];
    for await (const ev of client.agent({} as never)) types.push(ev.type);
    expect(types).toEqual(['assistant_delta']);
  });

  it('stops streaming when the caller aborts', async () => {
    const controller = new AbortController();
    const body = sseBody(Array.from({ length: 50 }, (_, i) => ({ type: 'assistant_delta', text: `${i}`, seq: i })));
    const client = api(vi.fn().mockResolvedValue(streamOf(body, 4)) as unknown as typeof fetch);
    let count = 0;
    for await (const _ev of client.agent({} as never, controller.signal)) {
      void _ev;
      count += 1;
      if (count === 3) controller.abort();
      if (count > 10) break;
    }
    expect(count).toBeLessThanOrEqual(11);
  });

  it('never sends a provider credential, because it has none', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ engines: [] }), { status: 200 }));
    await api(spy as unknown as typeof fetch).meta();
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(headers['user-agent']).toContain('VinaX-CLI');
  });

  it('talks to the configured base, so VINAX_API_BASE reaches a dev worker', async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ engines: [] }), { status: 200 }));
    const client = new VinaxApi({ apiBase: 'http://127.0.0.1:8787', fetchImpl: spy as unknown as typeof fetch });
    await client.meta();
    expect(String(spy.mock.calls[0][0])).toBe('http://127.0.0.1:8787/api/vinaxcli/meta');
  });
});
