/**
 * VinaX AI — free models found in the providers' own lists (discovery.ts):
 * each list parsed from a recorded fixture and filtered to chat models, the
 * registry entries they become (windows, prompt, flags), de-duplication
 * against the curated registry, caching and failure, the owner's switches,
 * and the routes: the picker lists them, the chat accepts only an id in the
 * current list, and the console shows them. No real provider is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetDiscovery, DISCOVERY_RETRY_MS, DISCOVERY_TTL_MS, discoveredSpecs, discoveryAllowed, discoveryStates, isChatId,
  openRouterFreeEntries, parseGemini, parseGroq, parseNvidia, parseOpenRouter, parseWorkersAi, prettyName, toSpec, type FoundModel, type ProviderState,
} from '../functions/_lib/ai/discovery';
import { pickerRegistryFor, sanitizeAiSettings } from '../functions/_lib/ai/config';
import { MODELS } from '../functions/_lib/ai/models';
import { artifactsOffered, promptFor } from '../functions/_lib/ai/prompt';
import { onRequestGet as modelsGet } from '../functions/api/ai/models';
import { onRequestPost as chatPost } from '../functions/api/ai/chat';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/ai';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { fixture, openAiSse, readEvents, sseResponse } from './helpers/aiStreams';
import type { AiEnv, ProviderId } from '../functions/_lib/ai/types';

const list = (name: string): unknown => JSON.parse(fixture(`models/${name}`));
const ids = (found: FoundModel[]): string[] => found.map((f) => f.upstream);
const NOW = Date.UTC(2026, 10, 3, 12, 0);

beforeEach(() => {
  _resetDiscovery();
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
});
afterEach(() => vi.unstubAllGlobals());

describe('reading each provider’s list', () => {
  it('Groq: every active chat model; no Whisper, TTS, guards or retired models', () => {
    const found = parseGroq(list('groq.json'));
    expect(ids(found)).toEqual(['openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'moonshotai/kimi-k2-instruct-0905']);
    expect(found[1]).toMatchObject({ name: 'Llama 4 Scout 17B 16e', vendor: 'Meta', contextTokens: 131_072, maxOutput: 8_192 });
    expect(found[4].vendor).toBe('Moonshot AI');
  });

  it('OpenRouter: free models only (":free" or both prices "0"), text out, no routers, guards or bad ids', () => {
    const found = parseOpenRouter(list('openrouter.json'));
    expect(ids(found)).toEqual([
      'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen2.5-vl-72b-instruct:free', 'deepseek/deepseek-r1-0528:free',
      'mistralai/mistral-small-3.2-24b-instruct', 'nvidia/nemotron-3.5-lightning:free',
    ]);
    const [llama, qwen, r1] = found;
    // The provider's own window wins over the model's nominal one.
    expect(llama).toMatchObject({ name: 'Llama 3.3 70B Instruct', vendor: 'Meta', contextTokens: 65_536, vision: false });
    expect(qwen.vision).toBe(true);
    expect(r1).toMatchObject({ name: 'R1 0528', vendor: 'DeepSeek', reasoning: true });
  });

  it('OpenRouter: a model listed free-priced and as ":free" appears once, as ":free"', () => {
    const m = (id: string) => ({ id, name: 'X: Y', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } });
    expect(ids(parseOpenRouter({ data: [m('a/b'), m('a/b:free'), m('c/d')] }))).toEqual(['a/b:free', 'c/d']);
    expect(parseOpenRouter({ data: [{ id: 'a/b', pricing: { prompt: '', completion: '' } }] })).toEqual([]);
  });

  it('Gemini: generateContent text models across pages; no image, TTS, Live, embeddings, AQA or computer use', () => {
    const found = parseGemini([list('gemini-1.json'), list('gemini-2.json')]);
    expect(ids(found)).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemma-3-27b-it']);
    expect(found[1]).toMatchObject({ name: 'Gemini 3.8 Flash', contextTokens: 1_048_576, vision: true, pdf: true, thinking: true, systemRole: true });
    expect(found[2].thinking).toBe(false);
    // Gemma takes no system instruction and no thinking config on the Gemini API.
    expect(found[4]).toMatchObject({ name: 'Gemma 3 27B', vendor: 'Google Gemma', systemRole: false, thinking: false, vision: false });
  });

  it('NVIDIA: chat models by name; no embeddings, rerankers, guards, parsers, reward models or charts readers', () => {
    expect(ids(parseNvidia(list('nvidia.json')))).toEqual(['nvidia/nemotron-3.5-lightning-30b-a3b', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'mistralai/mistral-small-24b-instruct']);
  });

  it('Workers AI: text generation from the binding’s search, no guards and nothing past its retirement date', () => {
    const found = parseWorkersAi(list('workers-ai.json'), NOW);
    expect(ids(found)).toEqual(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/openai/gpt-oss-120b']);
    expect(found[1]).toMatchObject({ name: 'Qwen3 30B A3B FP8', vendor: 'Qwen', contextTokens: 32_000, reasoning: true });
  });

  it('never trusts a list that is not the expected shape', () => {
    for (const junk of [null, 'ok', 42, { data: 'x' }, { data: [null, 1, 'a'] }]) {
      expect(parseGroq(junk)).toEqual([]);
      expect(parseOpenRouter(junk)).toEqual([]);
      expect(parseNvidia(junk)).toEqual([]);
      expect(parseWorkersAi(junk)).toEqual([]);
      expect(parseGemini([junk])).toEqual([]);
    }
  });

  it('isChatId and prettyName', () => {
    expect(isChatId('meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
    expect(isChatId('@cf/meta/llama-3.1-8b-instruct')).toBe(true);
    for (const id of ['whisper-large-v3', 'gemini-2.5-flash-preview-tts', 'nvidia/nv-embedqa-e5-v5', 'x/llamaguard-7b', 'gemini-live-2.5', 'a b', '"x"', 'x\ny']) expect(isChatId(id)).toBe(false);
    expect(prettyName('openai/gpt-oss-20b')).toBe('GPT OSS 20B');
    expect(prettyName('@cf/qwen/qwq-32b')).toBe('QwQ 32B');
    expect(prettyName('constructor')).toBe('Constructor');
  });
});

describe('registry entries', () => {
  it('the full prompt and artifacts for a roomy window, the compact prompt for a small one', () => {
    const big = toSpec('openrouter', { upstream: 'a/b:free', name: 'B', contextTokens: 131_072 });
    expect(big).toMatchObject({ id: 'openrouter:a/b:free', group: 'more-openrouter', discovered: true, maxContextChars: 100_000, maxOutput: 4_096 });
    expect(promptFor(big)).toBe('full');
    expect(artifactsOffered(big)).toBe(true);
    const small = toSpec('groq', { upstream: 'tiny-8k', name: 'Tiny', contextTokens: 8_192 });
    expect(small.maxOutput).toBe(2_048);
    expect(small.maxContextChars).toBe((8_192 - 2_048) * 3);
    expect(promptFor(small)).toBe('compact');
    expect(artifactsOffered(small)).toBe(false);
    // Groq keeps a short history (tokens per minute), like the curated Groq models.
    expect(toSpec('groq', { upstream: 'x', name: 'X', contextTokens: 131_072 }).maxContextChars).toBe(30_000);
    // No window in the list (NVIDIA): enough for the full prompt.
    expect(promptFor(toSpec('nvidia', { upstream: 'a/b', name: 'B' }))).toBe('full');
  });

  it('Gemini thinking models ask for thoughts; others send no thinking config', () => {
    expect(toSpec('gemini', { upstream: 'g', name: 'G', thinking: true, vision: true }).params).toEqual({ thinkingConfig: { includeThoughts: true } });
    const gemma = toSpec('gemini', { upstream: 'gemma-3-27b-it', name: 'Gemma', systemRole: false });
    expect(gemma.params).toBeUndefined();
    expect(gemma.flags.systemRole).toBe(false);
  });

  it('leaves out every curated, utility, ladder and voice id, and keeps names unique', () => {
    const st = (models: FoundModel[]): ProviderState => ({ at: NOW, ok: true, models, error: null, fetchedAt: NOW });
    const specs = discoveredSpecs({
      groq: st([...parseGroq(list('groq.json'))]),
      openrouter: st(parseOpenRouter(list('openrouter.json'))),
      gemini: st(parseGemini([list('gemini-1.json'), list('gemini-2.json')])),
      nvidia: st(parseNvidia(list('nvidia.json'))),
      cloudflare: st(parseWorkersAi(list('workers-ai.json'), NOW)),
    });
    const all = specs.map((s) => s.id);
    for (const curated of MODELS) expect(all).not.toContain(curated.id);
    expect(all).not.toContain('groq:openai/gpt-oss-120b');
    expect(all).not.toContain('gemini:gemini-2.5-flash');
    expect(all).not.toContain('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(all).toContain('gemini:gemini-3.8-flash');
    expect(all).toContain('cloudflare:@cf/openai/gpt-oss-120b');
    const names = [...MODELS.map((m) => m.name), ...specs.map((s) => s.name)].map((n) => n.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    // "Llama 3.3 70B" is curated (Workers AI): the found one says where it is.
    expect(specs.find((s) => s.id === 'nvidia:meta/llama-3.3-70b-instruct')?.name).toBe('Llama 3.3 70B (NVIDIA)');
    expect(specs.every((s) => s.discovered && s.group?.startsWith('more-'))).toBe(true);
  });
});

/** Fake fetchers that count their calls. */
function fetchers(over: Partial<Record<ProviderId, () => Promise<FoundModel[]>>> = {}) {
  const calls: Record<string, number> = {};
  const one = (p: ProviderId, models: FoundModel[]) => async () => {
    calls[p] = (calls[p] ?? 0) + 1;
    if (over[p]) return over[p]!();
    return models;
  };
  return {
    calls,
    f: {
      groq: one('groq', [{ upstream: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', contextTokens: 131_072 }]),
      openrouter: one('openrouter', [{ upstream: 'a/b:free', name: 'B', contextTokens: 32_768 }]),
      gemini: one('gemini', [{ upstream: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', thinking: true }]),
      nvidia: one('nvidia', [{ upstream: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' }]),
      cloudflare: one('cloudflare', [{ upstream: '@cf/openai/gpt-oss-120b', name: 'GPT OSS 120B' }]),
    },
  };
}

const KEYED = { GROQ_API_KEY: 'gsk_x', OPENROUTER_API_KEY: 'or_x', GEMINI_API_KEY: 'g_x' } as AiEnv;

describe('caching and failure', () => {
  it('asks only providers with a key, once per 6 hours', async () => {
    const { calls, f } = fetchers();
    const a = await discoveryStates(KEYED, true, { now: NOW, fetchers: f });
    expect(Object.keys(a).sort()).toEqual(['gemini', 'groq', 'openrouter']);
    await discoveryStates(KEYED, true, { now: NOW + DISCOVERY_TTL_MS - 1, fetchers: f });
    expect(calls).toEqual({ groq: 1, openrouter: 1, gemini: 1 });
    // Past six hours: the stale list answers at once while it refreshes.
    const pending: Array<Promise<unknown>> = [];
    const stale = await discoveryStates(KEYED, true, { now: NOW + DISCOVERY_TTL_MS, fetchers: f, waitUntil: (p) => pending.push(p) });
    expect(stale.groq?.models).toHaveLength(1);
    await Promise.all(pending);
    expect(calls.groq).toBe(2);
  });

  it('a failing list keeps the last good one and asks again in 15 minutes; with none it adds nothing', async () => {
    let fail = false;
    const { calls, f } = fetchers({ groq: async () => { if (fail) throw new Error('http_500'); return [{ upstream: 'x-chat', name: 'X' }]; } });
    await discoveryStates(KEYED, true, { now: NOW, fetchers: f, only: ['groq'] });
    fail = true;
    const after = await discoveryStates(KEYED, true, { now: NOW + DISCOVERY_TTL_MS + 1, fetchers: f, only: ['groq'] });
    await new Promise((r) => setTimeout(r, 0));
    const st = (await discoveryStates(KEYED, true, { now: NOW + DISCOVERY_TTL_MS + 2, fetchers: f, only: ['groq'] })).groq!;
    expect(after.groq?.models.map((m) => m.upstream)).toEqual(['x-chat']);
    expect(st).toMatchObject({ ok: false, error: 'http_500' });
    expect(st.models.map((m) => m.upstream)).toEqual(['x-chat']);
    expect(calls.groq).toBe(2);
    await discoveryStates(KEYED, true, { now: NOW + DISCOVERY_TTL_MS + DISCOVERY_RETRY_MS + 5, fetchers: f, only: ['groq'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.groq).toBe(3);

    _resetDiscovery();
    const none = await discoveryStates(KEYED, true, { now: NOW, fetchers: f, only: ['groq'] });
    expect(none.groq).toMatchObject({ ok: false, models: [] });
  });

  it('a slow provider is skipped for this request after the wait, and joins once it answers', async () => {
    let release: (v: FoundModel[]) => void = () => {};
    const { f } = fetchers({ groq: () => new Promise((r) => { release = r; }) });
    const first = await discoveryStates(KEYED, true, { now: NOW, fetchers: f, only: ['groq'], waitMs: 5 });
    expect(first.groq).toBeUndefined();
    release([{ upstream: 'late-chat', name: 'Late' }]);
    await new Promise((r) => setTimeout(r, 0));
    const next = await discoveryStates(KEYED, true, { now: NOW + 1, fetchers: f, only: ['groq'] });
    expect(next.groq?.models.map((m) => m.upstream)).toEqual(['late-chat']);
  });

  it('the owner’s switches: discover false, or one provider off; and model switches apply', async () => {
    expect(discoveryAllowed(false, 'groq')).toBe(false);
    expect(discoveryAllowed({ groq: false }, 'groq')).toBe(false);
    expect(discoveryAllowed({ groq: false }, 'gemini')).toBe(true);
    expect(sanitizeAiSettings({ discover: false }).discover).toBe(false);
    expect(sanitizeAiSettings({ discover: { openrouter: false, nope: false, groq: 'no' } }).discover).toEqual({ openrouter: false });
    expect(sanitizeAiSettings({}).discover).toBe(true);
    const { calls, f } = fetchers();
    expect(await discoveryStates(KEYED, { openrouter: false }, { now: NOW, fetchers: f })).not.toHaveProperty('openrouter');
    expect(calls.openrouter).toBeUndefined();
    const s = sanitizeAiSettings({ discover: true, models: { 'groq:llama-3.1-8b-instant': { enabled: false } } });
    const reg = await pickerRegistryFor(KEYED, s, { now: NOW, fetchers: f });
    expect(reg.map((m) => m.id)).not.toContain('groq:llama-3.1-8b-instant');
    expect(reg.map((m) => m.id)).toContain('gemini:gemini-3.8-flash');
    expect(reg.slice(0, MODELS.length - 2).every((m) => !m.discovered)).toBe(true);
    expect(await pickerRegistryFor(KEYED, sanitizeAiSettings({ discover: false }), { now: NOW, fetchers: f })).toHaveLength(MODELS.length);
  });
});

// ---------------------------------------------------------------- the routes

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ADMIN_LOGIN_PASSWORD: 'owner-pass', GROQ_API_KEY: 'gsk_test', ...DB_ENV };
let ip = 0;

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
const chatCalls: Array<{ url: string; model: string }> = [];
/** Groq's list from the fixture, and a chat answer that records which model was asked. */
const groqWorld = (listOk = true): Upstream => (url, init) => {
  if (url === 'https://api.groq.com/openai/v1/models') return listOk ? Response.json(list('groq.json')) : new Response('{"error":"down"}', { status: 503 });
  if (url.includes('/chat/completions')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string; messages: Array<{ content: string }> };
    if (!String(body.messages?.[0]?.content ?? '').includes('You write titles')) chatCalls.push({ url, model: body.model });
    return sseResponse(openAiSse('Hello there.'));
  }
  return new Response('nope', { status: 404 });
};
const seed = (upstream: Upstream, setting: unknown = { enabled: true }) => fakeDb({
  accounts: [{ id: '1001', name: 'Asha' }],
  settings: [{ key: 'vinax-ai', value: setting, updated_at: 'x', updated_by: 'owner' }],
}, upstream);

async function getPicker(env = ENV): Promise<{ groups: string[]; models: Array<{ id: string; name: string; group: string; provider: string; description: string; available: boolean }> }> {
  const res = await modelsGet({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}` } }), env: env as never });
  expect(res.status).toBe(200);
  return res.json() as never;
}

async function chat(model: string): Promise<Response> {
  const token = await issueSession(ENV, '1001');
  return chatPost({
    request: new Request('https://www.vinaxmusic.online/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'cf-connecting-ip': `203.0.113.${++ip % 250}` },
      body: JSON.stringify({ conversationId: null, content: [{ type: 'text', text: 'Hello, explain tides.' }], mode: 'model', model, timezone: 'Asia/Kolkata' }),
    }),
    env: ENV as never,
    waitUntil: () => undefined,
  });
}

describe('GET /api/ai/models', () => {
  it('lists the curated models, then Groq’s other free chat models in their own group', async () => {
    seed(groqWorld());
    const body = await getPicker();
    expect(body.groups).toContain('more-groq');
    const found = body.models.filter((m) => m.group === 'more-groq');
    expect(found.map((m) => m.id)).toEqual(['groq:meta-llama/llama-4-scout-17b-16e-instruct', 'groq:llama-3.1-8b-instant', 'groq:gemma2-9b-it', 'groq:moonshotai/kimi-k2-instruct-0905']);
    expect(found[0]).toMatchObject({ name: 'Llama 4 Scout 17B 16e', provider: 'Groq', description: 'Meta · 131K context', available: true });
    // Curated first, in the registry's order; a curated id is never repeated.
    expect(body.models.findIndex((m) => m.group === 'more-groq')).toBeGreaterThan(body.models.findIndex((m) => m.id === 'groq:openai/gpt-oss-120b'));
    expect(body.models.filter((m) => m.id === 'groq:openai/gpt-oss-120b')).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/gsk_test|api\.groq\.com/);
  });

  it('a failing list leaves the curated picker exactly as it was', async () => {
    seed(groqWorld(false));
    const broken = await getPicker();
    expect(broken.models.some((m) => m.group.startsWith('more-'))).toBe(false);
    expect(broken.models).toHaveLength(MODELS.filter((m) => m.group !== null).length);
  });

  it('the owner’s discover: false hides them', async () => {
    seed(groqWorld(), { enabled: true, discover: false });
    expect((await getPicker()).models.some((m) => m.group === 'more-groq')).toBe(false);
  });
});

describe('POST /api/ai/chat with a found model', () => {
  beforeEach(() => { chatCalls.length = 0; });

  it('a found id streams through the provider’s adapter with its upstream id', async () => {
    seed(groqWorld());
    const res = await chat('groq:llama-3.1-8b-instant');
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.find((e) => e.event === 'meta')?.data.model).toMatchObject({ id: 'groq:llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'Groq' });
    expect(events.filter((e) => e.event === 'text').map((e) => e.data.delta).join('')).toBe('Hello there.');
    expect(chatCalls).toEqual([{ url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant' }]);
  });

  it('an id that is not in the current list never goes upstream', async () => {
    seed(groqWorld());
    for (const id of ['groq:made-up-model', 'groq:whisper-large-v3', 'groq:meta-llama/llama-guard-4-12b', 'nvidia:meta/llama-3.3-70b-instruct', 'evil:x', 'groq:']) {
      const res = await chat(id);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'unknown_model' });
    }
    expect(chatCalls).toEqual([]);
  });

  it('a found model the owner switched off is refused, and so is every found model with discover off', async () => {
    seed(groqWorld(), { enabled: true, models: { 'groq:llama-3.1-8b-instant': { enabled: false } } });
    expect((await chat('groq:llama-3.1-8b-instant')).status).toBe(400);
    _resetDiscovery();
    resetSettingsMemo();
    seed(groqWorld(), { enabled: true, discover: false });
    expect((await chat('groq:gemma2-9b-it')).status).toBe(400);
    expect(chatCalls).toEqual([]);
  });
});

describe('the console', () => {
  const adminReq = (body?: unknown) => new Request('https://www.vinaxmusic.online/api/admin/ai', {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  it('lists found models after the curated ones, with what each provider’s list gave', async () => {
    seed(groqWorld());
    const body = await (await adminGet({ request: adminReq(), env: ENV as never })).json() as { models: Array<{ id: string; discovered?: boolean; ownerEnabled: boolean }>; discovery: { enabled: unknown; providers: Array<{ provider: string; ok: boolean; count: number }> } };
    expect(body.models.slice(0, MODELS.length).every((m) => !m.discovered)).toBe(true);
    expect(body.models.find((m) => m.id === 'groq:gemma2-9b-it')).toMatchObject({ discovered: true, ownerEnabled: true });
    expect(body.discovery).toMatchObject({ enabled: true, providers: [{ provider: 'groq', ok: true, count: 5 }] });
  });

  it('probes a found model, and refuses an unknown id', async () => {
    seed(groqWorld());
    const ok = await (await adminPost({ request: adminReq({ model: 'groq:gemma2-9b-it' }), env: ENV as never })).json() as { ok: boolean; model: string };
    expect(ok).toMatchObject({ ok: true, model: 'groq:gemma2-9b-it' });
    expect((await adminPost({ request: adminReq({ model: 'groq:made-up' }), env: ENV as never })).status).toBe(400);
  });
});

describe("OpenRouter's big list, read cheaply", () => {
  it('finds the same free models from the raw text as a full parse, without parsing every entry', () => {
    const full = list('openrouter.json');
    const text = JSON.stringify(full);
    expect(parseOpenRouter(openRouterFreeEntries(text))).toEqual(parseOpenRouter(full));
    const parsed = (openRouterFreeEntries(text) as { data: Array<{ id: string }> }).data;
    expect(parsed.length).toBeLessThan((full as { data: unknown[] }).data.length);
  });

  it('keeps the last entry, zero-priced entries, and falls back to a full parse for an unexpected layout', () => {
    const text = JSON.stringify({ data: [
      { id: 'a/paid', pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'b/zero', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
      { id: 'c/last:free', pricing: { prompt: '0', completion: '0' } },
    ] });
    expect((openRouterFreeEntries(text) as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual(['b/zero', 'c/last:free']);
    const pretty = JSON.stringify({ data: [{ id: 'x/y:free' }] }, null, 2);
    expect((openRouterFreeEntries(pretty) as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual(['x/y:free']);
    expect(openRouterFreeEntries('not json')).toBeNull();
  });
});

