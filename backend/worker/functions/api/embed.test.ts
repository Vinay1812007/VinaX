/** 8.2.0 — /api/embed and its engine ladder, against mocked providers only
 *  (live engines are verified after deploy). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost, parseEmbedRequest } from './embed';
import {
  EMBED_DIM,
  FLAGSHIP_EMBED_MODEL,
  NV_EMBED_PRIMARY,
  NV_EMBED_SECONDARY,
  defaultEmbeddingsUrl,
  defaultProviderKeys,
  embedEngines,
  embedTexts,
  normalise,
  readVectors,
  resetEmbedCooldowns,
} from '../_lib/embed';

const NV_ENV = { VINAX_NVIDIA_API_KEY: 'nv-key-1' };
const FLAG_ENV = { VINAX_GGL_GEMINI_API_KEY: 'flag-key' };

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const vec = (n: number, seed = 1): number[] => Array.from({ length: n }, (_, i) => ((i + seed) % 7) - 3 + 0.5);

function stub(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
    const call = { url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, headers: init?.headers ?? {} };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, body = '{}'): Response => new Response(body, { status });
const standardShaped = (count: number, dim: number): Response =>
  ok({ data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: vec(dim, i) })) });

const post = (body: unknown, env: Record<string, string>): Promise<Response> =>
  onRequestPost({
    request: new Request('http://localhost/api/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
    env,
  });

beforeEach(() => resetEmbedCooldowns());
afterEach(() => vi.unstubAllGlobals());

describe('normalise', () => {
  it('returns a unit vector and cuts to the asked size', () => {
    const v = normalise([3, 4, 12, 0], 2)!;
    expect(v).toHaveLength(2);
    expect(Math.hypot(...v)).toBeCloseTo(1, 4);
    expect(v[0]).toBeCloseTo(0.6, 4);
  });
  it('refuses zero and non-finite vectors', () => {
    expect(normalise([0, 0, 0])).toBeNull();
    expect(normalise([1, Number.NaN])).toBeNull();
  });
});

describe('readVectors', () => {
  it('orders standard rows by index', () => {
    const out = readVectors(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }));
    expect(out).toEqual([[1, 0], [0, 1]]);
  });
  it('reads native batch answers', () => {
    expect(readVectors(JSON.stringify({ embeddings: [{ values: [1, 2] }] }))).toEqual([[1, 2]]);
  });
  it('rejects malformed answers', () => {
    expect(readVectors('not json')).toBeNull();
    expect(readVectors(JSON.stringify({ data: [{ nope: 1 }] }))).toBeNull();
  });
});

describe('engine configuration', () => {
  it('derives the embeddings URL from the chat override', () => {
    expect(defaultEmbeddingsUrl({})).toBe('https://integrate.api.nvidia.com/v1/embeddings');
    expect(defaultEmbeddingsUrl({ NVIDIA_BASE_URL: 'https://proxy.example/v1/chat/completions' })).toBe('https://proxy.example/v1/embeddings');
    expect(defaultEmbeddingsUrl({ NVIDIA_BASE_URL: 'https://proxy.example/v1/' })).toBe('https://proxy.example/v1/embeddings');
  });
  it('10.3 — uses the one NVIDIA key, never another provider\'s', () => {
    expect(defaultProviderKeys({ ...NV_ENV, VINAX_GROQ_API_KEY: 'other-host' })).toEqual(['nv-key-1']);
    expect(defaultProviderKeys({ VINAX_NVIDIA_API_KEY: '  nv-key-1\n' })).toEqual(['nv-key-1']);
    expect(defaultProviderKeys({ VINAX_GROQ_API_KEY: 'other-host', VINAX_OPENROUTER_API_KEY: 'x', VINAX_GGL_GEMINI_API_KEY: 'g' })).toEqual([]);
  });
  it('skips engines whose key is unset and puts the preferred model first', () => {
    expect(embedEngines({}).map((e) => e.model)).toEqual([]);
    expect(embedEngines(FLAG_ENV).map((e) => e.model)).toEqual([FLAGSHIP_EMBED_MODEL]);
    expect(embedEngines({ ...NV_ENV, ...FLAG_ENV }, FLAGSHIP_EMBED_MODEL).map((e) => e.model)).toEqual([
      FLAGSHIP_EMBED_MODEL,
      NV_EMBED_PRIMARY,
      NV_EMBED_SECONDARY,
    ]);
  });
});

describe('embedTexts ladder', () => {
  it('asks the primary engine for 384 query dimensions and returns unit vectors', async () => {
    const calls = stub((c) => standardShaped((c.body.input as string[]).length, EMBED_DIM));
    const r = await embedTexts(NV_ENV, ['sad telugu songs', 'rain'], 'query');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model).toBe(NV_EMBED_PRIMARY);
    expect(r.dim).toBe(EMBED_DIM);
    expect(r.vectors).toHaveLength(2);
    for (const v of r.vectors) expect(Math.hypot(...v)).toBeCloseTo(1, 3);
    expect(calls[0].url).toBe('https://integrate.api.nvidia.com/v1/embeddings');
    expect(calls[0].body).toMatchObject({ model: NV_EMBED_PRIMARY, input_type: 'query', dimensions: EMBED_DIM });
    expect(calls[0].headers.authorization).toBe('Bearer nv-key-1');
  });

  it('retries without dimensions when the engine refuses them, cutting the answer itself', async () => {
    const calls = stub((c) => ('dimensions' in c.body ? fail(400, '{"detail":"dimensions not supported"}') : standardShaped(1, 2048)));
    const r = await embedTexts(NV_ENV, ['x'], 'passage');
    expect(r.ok && r.dim).toBe(EMBED_DIM);
    expect(calls).toHaveLength(2);
  });

  it('a 401 on the NVIDIA key moves to the secondary model, then the flagship engine', async () => {
    const calls = stub((c) => {
      if (c.url.includes('integrate.api.nvidia.com')) return c.body.model === NV_EMBED_PRIMARY ? fail(401) : fail(500);
      return ok({ embeddings: [{ values: vec(EMBED_DIM) }] });
    });
    const r = await embedTexts({ ...NV_ENV, ...FLAG_ENV }, ['x'], 'query');
    expect(r.ok && r.model).toBe(FLAGSHIP_EMBED_MODEL);
    const keysTried = calls.filter((c) => c.body.model === NV_EMBED_PRIMARY).map((c) => c.headers.authorization);
    expect(keysTried).toEqual(['Bearer nv-key-1']);
    const native = calls.find((c) => c.url.includes(':batchEmbedContents'))!;
    expect(native.headers['x-goog-api-key']).toBe('flag-key');
    expect((native.body.requests as Array<Record<string, unknown>>)[0]).toMatchObject({ taskType: 'RETRIEVAL_QUERY', outputDimensionality: EMBED_DIM });
  });

  it('moves from the native door to the standard door on a wrong-door answer', async () => {
    const calls = stub((c) => (c.url.includes(':batchEmbedContents') ? fail(403, 'API_KEY_INVALID') : standardShaped(1, 3072)));
    const r = await embedTexts(FLAG_ENV, ['x'], 'passage');
    expect(r.ok && r.model).toBe(FLAGSHIP_EMBED_MODEL);
    expect(r.ok && r.dim).toBe(EMBED_DIM);
    expect(calls.map((c) => c.url)).toContain('https://generativelanguage.googleapis.com/v1beta/openai/embeddings');
  });

  it('keeps the non-truncatable model at its own size', async () => {
    stub((c) => (c.body.model === NV_EMBED_SECONDARY ? standardShaped(1, 1024) : fail(404)));
    const r = await embedTexts(NV_ENV, ['x'], 'passage');
    expect(r.ok && r.model).toBe(NV_EMBED_SECONDARY);
    expect(r.ok && r.dim).toBe(1024);
  });

  it('rejects an answer with the wrong number of vectors', async () => {
    stub(() => standardShaped(1, EMBED_DIM));
    const r = await embedTexts(NV_ENV, ['a', 'b'], 'passage');
    expect(r.ok).toBe(false);
  });

  it('skips a cooling engine on the next call', async () => {
    let primaryCalls = 0;
    stub((c) => {
      if (c.body.model === NV_EMBED_PRIMARY) {
        primaryCalls += 1;
        return fail(503);
      }
      return standardShaped(1, 1024);
    });
    await embedTexts(NV_ENV, ['x'], 'passage');
    await embedTexts(NV_ENV, ['x'], 'passage');
    expect(primaryCalls).toBe(1);
  });

  it('answers no_engine when nothing is configured or everything fails', async () => {
    const none = await embedTexts({}, ['x'], 'query');
    expect(none).toEqual({ ok: false, error: 'no_engine', tried: [] });
    stub(() => fail(500));
    const dead = await embedTexts({ ...NV_ENV, ...FLAG_ENV }, ['x'], 'query');
    expect(dead.ok).toBe(false);
  });

  it('survives network errors and timeouts', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const r = await embedTexts(NV_ENV, ['x'], 'query', { timeoutMs: 50 });
    expect(r.ok).toBe(false);
  });
});

describe('parseEmbedRequest', () => {
  it('accepts 1–64 non-empty strings, clips each to 512 chars, defaults kind to passage', () => {
    const r = parseEmbedRequest({ texts: ['  a  b ', 'x'.repeat(900)] })!;
    expect(r.texts[0]).toBe('a b');
    expect(r.texts[1]).toHaveLength(512);
    expect(r.kind).toBe('passage');
  });
  it('refuses bad shapes', () => {
    expect(parseEmbedRequest(null)).toBeNull();
    expect(parseEmbedRequest({ texts: [] })).toBeNull();
    expect(parseEmbedRequest({ texts: Array(65).fill('a') })).toBeNull();
    expect(parseEmbedRequest({ texts: ['a', 3] })).toBeNull();
    expect(parseEmbedRequest({ texts: ['   '] })).toBeNull();
    expect(parseEmbedRequest({ texts: ['a'], kind: 'other' })).toBeNull();
  });
  it('keeps only a model-shaped prefer value', () => {
    expect(parseEmbedRequest({ texts: ['a'], prefer: NV_EMBED_PRIMARY })!.prefer).toBe(NV_EMBED_PRIMARY);
    expect(parseEmbedRequest({ texts: ['a'], prefer: 'bad value!' })!.prefer).toBeNull();
  });
});

describe('POST /api/embed', () => {
  it('answers {model, dim, vectors}', async () => {
    stub((c) => standardShaped((c.body.input as string[]).length, EMBED_DIM));
    const res = await post({ texts: ['a', 'b'], kind: 'query' }, NV_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const data = (await res.json()) as { model: string; dim: number; vectors: number[][] };
    expect(data.model).toBe(NV_EMBED_PRIMARY);
    expect(data.dim).toBe(EMBED_DIM);
    expect(data.vectors).toHaveLength(2);
  });

  it('answers 503 no_engine when no engine is configured', async () => {
    const res = await post({ texts: ['a'], kind: 'query' }, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no_engine' });
  });

  it('answers 400 on a bad body and 405 on GET', async () => {
    expect((await post({ texts: 'nope' }, NV_ENV)).status).toBe(400);
    expect((await onRequestGet()).status).toBe(405);
  });
});
