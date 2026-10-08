/**
 * 11.2 — Cloudflare Workers AI, the fifth free provider, through the Worker's
 * AI binding: the curated catalogue, the binding transport (re-framed as
 * chat-completions SSE), error → cooldown mapping, and the rule that Auto
 * never routes to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLaneCooldowns, cooldownForFailure, laneAttempts, noteProviderFailure, providerKey, providerKeySource, providerCoolingDown, defaultLadder, type AiEnv } from '../functions/_lib/ai';
import { fetchCatalog, findCatalogModel, resetCatalogCache } from '../functions/_lib/catalog';
import {
  WORKERS_AI_MODELS,
  frameText,
  parseWorkersAiListing,
  plainMessages,
  resetWorkersAi,
  resultText,
  secondsToUtcMidnight,
  workersAiCatalog,
  workersAiErrorStatus,
  workersAiFetch,
  type WorkersAiBinding,
} from '../functions/_lib/workersai';

const enc = new TextEncoder();
const streamOf = (...frames: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
const binding = (run: WorkersAiBinding['run'], models?: WorkersAiBinding['models']): WorkersAiBinding & { run: ReturnType<typeof vi.fn> } =>
  ({ run: vi.fn(run), ...(models ? { models } : {}) }) as never;
const contents = (sse: string): string[] =>
  sse
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice(6)) as { choices: Array<{ delta?: { content?: string } }> })
    .map((j) => j.choices[0]?.delta?.content ?? '')
    .filter(Boolean);

beforeEach(() => {
  resetWorkersAi();
  resetCatalogCache();
  clearLaneCooldowns();
});
afterEach(() => vi.unstubAllGlobals());

describe('Workers AI — configured by the binding, no key', () => {
  it('is configured exactly when the binding exists, and names the binding, not a secret', () => {
    expect(providerKey({}, 'cloudflare')).toBeNull();
    expect(providerKey({ AI: {} }, 'cloudflare')).toBeNull();
    const env = { AI: binding(async () => ({ response: 'x' })) };
    expect(providerKey(env, 'cloudflare')).toBe('binding:AI');
    expect(providerKeySource(env, 'cloudflare')).toEqual({ name: 'AI', fallback: false });
  });

  it('is never on the Auto ladder', () => {
    expect(defaultLadder()).not.toContain('workers');
    const env = { AI: binding(async () => ({ response: 'x' })) } as AiEnv;
    expect(laneAttempts(env, 'chat')).toEqual([]);
  });
});

describe('Workers AI — catalogue', () => {
  it('is the curated list with original names and makers, chat only, every slug @cf/', async () => {
    expect(WORKERS_AI_MODELS.length).toBeGreaterThanOrEqual(8);
    for (const m of WORKERS_AI_MODELS) {
      expect(m.id).toMatch(/^@cf\/[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(m.name).toBeTruthy();
      expect(m.maker).toBeTruthy();
    }
    expect(await workersAiCatalog(null)).toEqual([]);
    const env = { AI: binding(async () => ({ response: 'x' })) };
    const list = await fetchCatalog(env, 'cloudflare');
    expect(list.map((m) => m.id)).toEqual(WORKERS_AI_MODELS.map((m) => m.id));
    expect(list[0]).toEqual({ id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct (fp8, fast)', maker: 'Meta', context: null, vision: false });
    expect(await fetchCatalog({}, 'cloudflare')).toEqual([]);
  });

  it('a binding listing only removes curated models it does not list; a failed or empty one changes nothing', async () => {
    const rows = [
      { name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', task: { name: 'Text Generation' } },
      { name: '@cf/openai/gpt-oss-20b', task: { name: 'Text Generation' } },
      { name: '@cf/some/unreviewed-model', task: { name: 'Text Generation' } },
      { name: '@cf/meta/llama-3.1-8b-instruct-fast', task: { name: 'Text-to-Image' } },
    ];
    expect([...parseWorkersAiListing(rows)]).toEqual(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-20b', '@cf/some/unreviewed-model']);
    const listed = await workersAiCatalog(binding(async () => null, async () => rows));
    expect(listed.map((m) => m.id)).toEqual(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-20b']);
    expect(await workersAiCatalog(binding(async () => null, async () => []))).toHaveLength(WORKERS_AI_MODELS.length);
    expect(await workersAiCatalog(binding(async () => null, async () => { throw new Error('boom'); }))).toHaveLength(WORKERS_AI_MODELS.length);
  });

  it('accepts a leading @ in a picked slug — and only a listed one', async () => {
    const env = { AI: binding(async () => ({ response: 'x' })) };
    expect((await findCatalogModel(env, 'cloudflare', '@cf/qwen/qwq-32b'))?.name).toBe('QwQ 32B');
    expect(await findCatalogModel(env, 'cloudflare', '@cf/acme/not-curated')).toBeNull();
    expect(await findCatalogModel(env, 'cloudflare', '@@cf/qwen/qwq-32b')).toBeNull();
    expect(await findCatalogModel(env, 'cloudflare', 'cf/qwen@qwq-32b')).toBeNull();
  });

  it('a model the binding says does not exist rests for a day and leaves the list', async () => {
    const env = { AI: binding(async () => ({ response: 'x' })) };
    const c = noteProviderFailure('cloudflare', '@cf/qwen/qwq-32b', 404, '{"error":{"message":"Workers AI: 5007: No such model"}}');
    expect(c?.reason).toBe('model_gone');
    expect(providerCoolingDown('cloudflare', '@cf/qwen/qwq-32b', Date.now() + 23 * 3600_000)).toBe(true);
    expect((await fetchCatalog(env, 'cloudflare')).map((m) => m.id)).not.toContain('@cf/qwen/qwq-32b');
  });
});

describe('Workers AI — transport', () => {
  it('re-frames the classic { response } stream as chat-completions SSE, with usage', async () => {
    const ai = binding(async () => streamOf('data: {"response":"Hel"}\n\ndata: {"resp', 'onse":"lo"}\n\n', 'data: {"response":"","usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\ndata: [DONE]\n\n'));
    const res = await workersAiFetch(ai, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', messages: [{ role: 'user', content: 'hi' }], stream: true, max_tokens: 64, temperature: 0.5, reasoning_effort: 'low', stream_options: { include_usage: true } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(contents(text).join('')).toBe('Hello');
    expect(text).toContain('"usage":{"prompt_tokens":7,"completion_tokens":2}');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
    // Only the fields Workers AI understands travel.
    expect(ai.run).toHaveBeenCalledWith('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'user', content: 'hi' }], stream: true, max_tokens: 64, temperature: 0.5 });
  });

  it('reads the OpenAI-shaped and Responses-shaped frames too, and skips reasoning', () => {
    expect(frameText({ choices: [{ delta: { content: 'a' } }] })).toBe('a');
    expect(frameText({ choices: [{ delta: { reasoning_content: 'thinking' } }] })).toBe('');
    expect(frameText({ type: 'response.output_text.delta', delta: 'b' })).toBe('b');
    expect(frameText({ type: 'response.reasoning_text.delta', delta: 'x' })).toBe('');
    expect(resultText({ response: 'c' })).toBe('c');
    expect(resultText({ choices: [{ message: { content: 'd' } }] })).toBe('d');
    expect(resultText({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'no' }] }, { type: 'message', content: [{ type: 'output_text', text: 'e' }] }] })).toBe('e');
  });

  it('answers a non-streamed call as a chat-completions JSON body', async () => {
    const ai = binding(async () => ({ response: 'OK', usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    const res = await workersAiFetch(ai, { model: '@cf/openai/gpt-oss-20b', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }, { type: 'image_url', image_url: { url: 'data:x' } }] }], max_tokens: 4 });
    expect(await res.json()).toMatchObject({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    expect(plainMessages([{ role: 'tool', content: [{ type: 'text', text: 'a' }, { type: 'image_url' }] }])).toEqual([{ role: 'user', content: 'a' }]);
  });

  it('maps binding errors to statuses the cooldown table understands', () => {
    expect(workersAiErrorStatus('4006: you have used up your daily free allocation of 10,000 neurons')).toBe(429);
    expect(workersAiErrorStatus('5007: No such model @cf/x/y or task')).toBe(404);
    expect(workersAiErrorStatus('3040: Capacity temporarily exceeded, please try again.')).toBe(503);
    expect(workersAiErrorStatus('5021: The estimated number of input and maximum output tokens exceeded this model context window limit.')).toBe(400);
    expect(workersAiErrorStatus('something odd')).toBe(502);
  });

  it('a spent allowance rests until 00:00 UTC (capped at 6 h) and short-circuits every later call', async () => {
    const now = Date.UTC(2026, 9, 8, 21, 0, 0);
    expect(secondsToUtcMidnight(now)).toBe(3 * 3600);
    const ai = binding(async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); });
    const res = await workersAiFetch(ai, { model: '@cf/qwen/qwq-32b', messages: [], stream: true }, undefined, now);
    expect(res.status).toBe(429);
    const body = await res.text();
    expect(cooldownForFailure(429, body)).toEqual({ ms: 3 * 3600_000, scope: 'model', reason: 'rate_limited' });
    const again = await workersAiFetch(ai, { model: '@cf/openai/gpt-oss-20b', messages: [], stream: true }, undefined, now + 1000);
    expect(again.status).toBe(429);
    expect(ai.run).toHaveBeenCalledTimes(1);
    // A plain rate limit keeps the ordinary short cooldown.
    resetWorkersAi();
    const limited = await workersAiFetch(binding(async () => { throw new Error('Too many requests'); }), { model: '@cf/qwen/qwq-32b', messages: [] }, undefined, now);
    expect(cooldownForFailure(limited.status, await limited.text())?.ms).toBe(60_000);
  });

  it('an abort before the answer starts rejects like fetch', async () => {
    const ai = binding(() => new Promise(() => undefined));
    const c = new AbortController();
    const p = workersAiFetch(ai, { model: '@cf/qwen/qwq-32b', messages: [] }, c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Workers AI — VinaX AI chat', () => {
  type Ctx = { request: Request; env: Record<string, unknown> };
  const post = async (body: Record<string, unknown>, env: Record<string, unknown>): Promise<Response> => {
    vi.resetModules();
    const m = (await import('../functions/api/vinaxai')) as unknown as { onRequestPost: (c: Ctx) => Promise<Response> };
    const request = new Request('https://example.test/api/vinaxai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.88.2.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...body }),
    });
    return m.onRequestPost({ request, env });
  };

  it('a picked Workers AI model streams through the binding, never through fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const ai = binding(async () => streamOf('data: {"response":"Namaste"}\n\n', 'data: [DONE]\n\n'));
    const res = await post({ mode: 'model', provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, { AI: ai });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Namaste');
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0][0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    const inputs = ai.run.mock.calls[0][1] as { messages: Array<{ role: string; content: string }>; stream: boolean };
    expect(inputs.stream).toBe(true);
    expect(inputs.messages[0].content).toContain('Llama 3.3 70B Instruct (fp8, fast) by Meta, served through Cloudflare');
    expect((fetchSpy.mock.calls as unknown[][]).some((c) => String(c[0]).startsWith('workers-ai:'))).toBe(false);
  });

  it('Auto with only the binding does not route to Workers AI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const ai = binding(async () => ({ response: 'x' }));
    const res = await post({ mode: 'auto' }, { AI: ai });
    expect(res.status).not.toBe(200);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('an unlisted Workers AI slug is refused before any call', async () => {
    const ai = binding(async () => ({ response: 'x' }));
    const res = await post({ mode: 'model', provider: 'cloudflare', model: '@cf/acme/paid-model' }, { AI: ai });
    expect(res.status).toBe(400);
    expect(ai.run).not.toHaveBeenCalled();
  });
});
