/**
 * 10.3 — the owner console's AI endpoints by provider: the AI Lab benches any
 * catalogue model on its provider's single key, the engine test probes one of
 * the four keys, health reports the four keys plus per-lane success, and the
 * env checklist names the four keys. Also: the Gemini transport carries an
 * attached image to the native endpoints. Upstreams are mocked: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as ailabPost } from '../functions/api/admin/ailab';
import { onRequestGet as enginetestGet } from '../functions/api/admin/enginetest';
import { onRequestGet as healthGet } from '../functions/api/admin/health';
import { onRequestGet as envcheckGet } from '../functions/api/admin/envcheck';
import { clearLaneCooldowns } from '../functions/_lib/ai';
import { resetCatalogCache } from '../functions/_lib/catalog';
import { nativeParts, resetMaestroMode, resetMaestroModels, toNativeRequest } from '../functions/_lib/maestro';

const KEYS = { VINAX_NVIDIA_API_KEY: 'nv', VINAX_OPENROUTER_API_KEY: 'or', VINAX_GROQ_API_KEY: 'gq', VINAX_GGL_GEMINI_API_KEY: 'AIza-gm' };
const ADMIN = { ADMIN_LOGIN_PASSWORD: 'test-secret' };

const LISTS: Record<string, unknown> = {
  'integrate.api.nvidia.com/v1/models': { data: [{ id: 'moonshotai/kimi-k3' }, { id: 'openai/gpt-oss-20b' }] },
  'openrouter.ai/api/v1/models': { data: [{ id: 'inclusionai/ling-3.1-flash', name: 'inclusionAI: Ling 3.1 Flash', pricing: { prompt: '0', completion: '0' } }] },
  'api.groq.com/openai/v1/models': { data: [{ id: 'llama-3.1-8b-instant', owned_by: 'Meta' }] },
  'generativelanguage.googleapis.com/v1beta/models?': { models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] }] },
};
const calls: Array<{ url: string; body: Record<string, unknown> | null; headers: Record<string, string> }> = [];
let reply: (url: string) => Response;

beforeEach(() => {
  clearLaneCooldowns();
  resetCatalogCache();
  resetMaestroMode();
  resetMaestroModels();
  calls.length = 0;
  reply = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [needle, list] of Object.entries(LISTS)) if (url.includes(needle)) return new Response(JSON.stringify(list), { status: 200 });
    let body: Record<string, unknown> | null;
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    return reply(url);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let ip = 0;
const req = (path: string, body?: unknown): Request => {
  ip += 1;
  return new Request(`https://admin.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-token': 'test-secret', 'content-type': 'application/json', 'cf-connecting-ip': `10.40.${Math.floor(ip / 250)}.${ip % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const frames = async (res: Response): Promise<Array<Record<string, unknown>>> =>
  (await res.text()).split('\n\n').filter((f) => f.startsWith('data:')).map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
const MSGS = [{ role: 'user', content: 'ping' }];

describe('AI Lab — bench by provider', () => {
  it('benches any model the provider lists, on that provider\'s key, and names it', async () => {
    const res = await ailabPost({ request: req('/api/admin/ailab', { provider: 'nvidia', model: 'moonshotai/kimi-k3', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    const out = await frames(res);
    expect(out[0]).toEqual({ meta: { model: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'nvidia', lane: 'chat' } });
    expect(calls[0].url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer nv');
    expect(calls[0].body?.model).toBe('moonshotai/kimi-k3');
  });

  it('a lane pin the public list leaves out may still be benched; anything else is unknown_model', async () => {
    const pinned = await ailabPost({ request: req('/api/admin/ailab', { provider: 'nvidia', model: 'mistralai/mistral-large', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    expect((await frames(pinned))[0]).toMatchObject({ meta: { model: 'mistralai/mistral-large', provider: 'nvidia' } });
    const unknown = await ailabPost({ request: req('/api/admin/ailab', { provider: 'groq', model: 'moonshotai/kimi-k3', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'unknown_model', provider: 'groq' });
    const badProvider = await ailabPost({ request: req('/api/admin/ailab', { provider: 'elsewhere', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    expect(badProvider.status).toBe(400);
  });

  it('a provider with no model named benches that provider\'s lane default; the old { lane } form still works, bench lanes do not', async () => {
    const byProvider = await ailabPost({ request: req('/api/admin/ailab', { provider: 'groq', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    expect((await frames(byProvider))[0]).toMatchObject({ meta: { model: 'llama-3.1-8b-instant', provider: 'groq', lane: 'scholar' } });
    const byLane = await ailabPost({ request: req('/api/admin/ailab', { lane: 'deep', messages: MSGS }), env: { ...ADMIN, ...KEYS } });
    expect((await frames(byLane))[0]).toMatchObject({ meta: { model: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia', lane: 'deep' } });
    for (const gone of ['agent', 'dsflash', 'muse', 'rank', 'laguna', 'diffusion', 'gemma4']) {
      const res = await ailabPost({ request: req('/api/admin/ailab', { lane: gone, messages: MSGS }), env: { ...ADMIN, ...KEYS } });
      expect(res.status, gone).toBe(400);
    }
  });

  it('a missing key is reported honestly, by its secret name', async () => {
    const res = await ailabPost({ request: req('/api/admin/ailab', { provider: 'openrouter', messages: MSGS }), env: { ...ADMIN } });
    expect(await res.json()).toMatchObject({ error: 'not_configured', head: 'OPENROUTER_API_KEY is not set', provider: 'openrouter' });
  });
});

describe('engine test — one probe per provider key', () => {
  const okJson = (): Response => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });

  it('probes the NVIDIA key by default, and each provider by name or id', async () => {
    reply = okJson;
    const def = (await (await enginetestGet({ request: req('/api/admin/enginetest'), env: { ...ADMIN, ...KEYS } })).json()) as Record<string, unknown>;
    expect(def).toMatchObject({ key: 'NVIDIA', provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', status: 200 });
    expect(calls[0].headers.authorization).toBe('Bearer nv');
    const or = (await (await enginetestGet({ request: req('/api/admin/enginetest?key=openrouter&model=inclusionai/ling-3.1-flash'), env: { ...ADMIN, ...KEYS } })).json()) as Record<string, unknown>;
    expect(or).toMatchObject({ provider: 'openrouter', model: 'inclusionai/ling-3.1-flash', status: 200 });
    const legacy = (await (await enginetestGet({ request: req('/api/admin/enginetest?key=GROQ_API_KEY'), env: { ...ADMIN, ...KEYS } })).json()) as Record<string, unknown>;
    expect(legacy).toMatchObject({ provider: 'groq', model: 'llama-3.1-8b-instant' });
  });

  it('refuses an unknown key name, an unlisted model and a missing secret', async () => {
    expect((await enginetestGet({ request: req('/api/admin/enginetest?key=LIGHTNING'), env: { ...ADMIN, ...KEYS } })).status).toBe(400);
    const unlisted = await enginetestGet({ request: req('/api/admin/enginetest?key=GROQ&model=made/up'), env: { ...ADMIN, ...KEYS } });
    expect(unlisted.status).toBe(400);
    expect(await unlisted.json()).toMatchObject({ error: 'unknown_model' });
    const missing = await enginetestGet({ request: req('/api/admin/enginetest?key=GEMINI'), env: { ...ADMIN } });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ env: 'GEMINI_API_KEY' });
    expect(calls).toHaveLength(0);
  });
});

describe('health — the four keys and every lane', () => {
  it('pings one row per provider key and lists every lane with its provider', async () => {
    reply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 });
    const res = await healthGet({ request: req('/api/admin/health'), env: { ...ADMIN, VINAX_NVIDIA_API_KEY: 'nv', VINAX_GROQ_API_KEY: 'gq' } });
    const body = (await res.json()) as { ai: Array<Record<string, unknown>>; lanes: Array<Record<string, unknown>> };
    // 10.3 — the primary secret name, and the name supplying the key right now.
    expect(body.ai.map((r) => [r.provider, r.env, r.envInUse, r.configured, r.ok])).toEqual([
      ['nvidia', 'NVIDIA_API_KEY', 'VINAX_NVIDIA_API_KEY', true, true],
      ['openrouter', 'OPENROUTER_API_KEY', null, false, false],
      ['groq', 'GROQ_API_KEY', 'VINAX_GROQ_API_KEY', true, true],
      ['gemini', 'GEMINI_API_KEY', null, false, false],
      // 11.2 — Workers AI names its binding, not a secret.
      ['cloudflare', 'AI', null, false, false],
    ]);
    expect(body.ai[0].lanes).toEqual(['dj', 'chat', 'deep', 'fast', 'home', 'search', 'pro', 'mini', 'vision', 'vision90']);
    expect(body.lanes.map((l) => l.lane)).toEqual(['dj', 'chat', 'deep', 'fast', 'scholar', 'home', 'search', 'pro', 'mini', 'router', 'maestro', 'vision', 'vision90', 'workers']);
    expect(body.lanes.find((l) => l.lane === 'router')).toMatchObject({ provider: 'openrouter', keySet: false, calls: 0 });
    expect(body.lanes.find((l) => l.lane === 'scholar')).toMatchObject({ provider: 'groq', keySet: true });
    // Four keys → at most two live pings here (two are unset).
    expect(calls.filter((c) => c.url.includes('chat/completions'))).toHaveLength(2);
  });
});

describe('env checklist', () => {
  it('lists the four AI keys and none of the removed ones', async () => {
    const res = await envcheckGet({ request: req('/api/admin/envcheck'), env: { ...ADMIN, VINAX_NVIDIA_API_KEY: 'nv', GROQ_API_KEY: 'gq' } });
    const body = (await res.json()) as { items: Array<{ name: string; group: string; set: boolean; fallback?: string; usingFallback?: boolean; note: string }> };
    const ai = body.items.filter((i) => i.group === 'AI');
    // 10.3 — the primary names, each with its previous name as the fallback.
    expect(ai.map((i) => i.name)).toEqual(['NVIDIA_BASE_URL', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'VINAX_MAESTRO_MODEL']);
    const nv = ai.find((i) => i.name === 'NVIDIA_API_KEY');
    expect(nv).toMatchObject({ set: true, fallback: 'VINAX_NVIDIA_API_KEY', usingFallback: true });
    expect(nv?.note).toContain('rename it to NVIDIA_API_KEY');
    expect(ai.find((i) => i.name === 'GROQ_API_KEY')).toMatchObject({ set: true, usingFallback: false });
    expect(ai.find((i) => i.name === 'GEMINI_API_KEY')).toMatchObject({ set: false, usingFallback: false });
    // Names only — never a value.
    expect(JSON.stringify(body)).not.toContain('"nv"');
  });
});

describe('Gemini transport — images reach the native endpoints', () => {
  it('turns an image_url data URL into inline data next to the text', () => {
    const parts = nativeParts([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      { type: 'image_url', image_url: { url: 'https://example.test/remote.png' } },
    ]);
    expect(parts).toEqual([{ text: 'what is this?' }, { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }]);
    expect(nativeParts('plain')).toEqual([{ text: 'plain' }]);
    expect(nativeParts([])).toEqual([{ text: ' ' }]);
  });

  it('toNativeRequest keeps the image on the user turn', () => {
    const native = toNativeRequest({ messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] }) as { contents: Array<{ parts: unknown[] }> };
    expect(native.contents[0].parts).toEqual([{ text: 'hi' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }]);
  });
});
