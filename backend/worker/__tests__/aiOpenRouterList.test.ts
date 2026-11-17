/**
 * VinaX AI — OpenRouter's free list (openRouterList.ts): which ids count as
 * free, the cheap read of its big list, caching and failure, and the one
 * thing the list is for: a curated OpenRouter model it no longer has leaves
 * the picker. Model discovery is gone (2026-11-17), so nothing outside the
 * curated, approved registry is ever offered, accepted or shown. No real
 * provider is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetOpenRouterList, LIST_RETRY_MS, LIST_TTL_MS, openRouterFreeEntries, openRouterListed, parseOpenRouterFree, type ListFetcher,
} from '../functions/_lib/ai/openRouterList';
import { prettyName } from '../functions/_lib/ai/modelName';
import { pickerRegistryFor, sanitizeAiSettings } from '../functions/_lib/ai/config';
import { APPROVED_MODELS, MODELS, PICKER_GROUPS } from '../functions/_lib/ai/models';
import { onRequestGet as modelsGet } from '../functions/api/ai/models';
import { onRequestPost as chatPost } from '../functions/api/ai/chat';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/ai';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { fixture } from './helpers/aiStreams';
import type { AiEnv } from '../functions/_lib/ai/types';

const list = (name: string): unknown => JSON.parse(fixture(`models/${name}`));
const NOW = Date.UTC(2026, 10, 3, 12, 0);
const KEYED = { OPENROUTER_API_KEY: 'or_x' } as AiEnv;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetOpenRouterList();
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
});
afterEach(() => vi.unstubAllGlobals());

describe('reading the list', () => {
  it('free models only (":free" or both prices "0"), text out, no routers or bad ids', () => {
    expect(parseOpenRouterFree(list('openrouter.json'))).toEqual([
      'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen2.5-vl-72b-instruct:free', 'deepseek/deepseek-r1-0528:free',
      'mistralai/mistral-small-3.2-24b-instruct', 'nvidia/nemotron-3.5-lightning:free', 'meta-llama/llama-guard-4-12b:free',
    ]);
    expect(parseOpenRouterFree({ data: [{ id: 'a/b', pricing: { prompt: '', completion: '' } }] })).toEqual([]);
  });

  it('never trusts a list that is not the expected shape', () => {
    for (const junk of [null, 'ok', 42, { data: 'x' }, { data: [null, 1, 'a'] }]) expect(parseOpenRouterFree(junk)).toEqual([]);
  });

  it('finds the same free models from the raw text as a full parse, without parsing every entry', () => {
    const full = list('openrouter.json');
    const text = JSON.stringify(full);
    expect(parseOpenRouterFree(openRouterFreeEntries(text))).toEqual(parseOpenRouterFree(full));
    expect((openRouterFreeEntries(text) as { data: unknown[] }).data.length).toBeLessThan((full as { data: unknown[] }).data.length);
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

describe('caching and failure', () => {
  it('no key: null, and OpenRouter is never asked', async () => {
    const fetcher = vi.fn<ListFetcher>(async () => ['a/b:free']);
    expect(await openRouterListed({} as AiEnv, { now: NOW, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never waits for a slow list; later requests use it, once per 6 hours', async () => {
    let calls = 0;
    let release: (ids: string[]) => void = () => undefined;
    const fetcher: ListFetcher = () => { calls += 1; return new Promise((r) => { release = r; }); };
    const pending: Array<Promise<unknown>> = [];
    expect(await openRouterListed(KEYED, { now: NOW, fetcher, waitUntil: (p) => pending.push(p) })).toBeNull();
    expect(pending).toHaveLength(1);
    release(['a/b:free']);
    await Promise.all(pending);
    expect([...(await openRouterListed(KEYED, { now: NOW + 1, fetcher }))!]).toEqual(['a/b:free']);
    await openRouterListed(KEYED, { now: NOW + LIST_TTL_MS - 1, fetcher });
    expect(calls).toBe(1);
    // Past six hours: the stale list answers at once while it refreshes.
    const stale = await openRouterListed(KEYED, { now: NOW + LIST_TTL_MS, fetcher });
    expect([...stale!]).toEqual(['a/b:free']);
    expect(calls).toBe(2);
  });

  it('a failing list keeps the last good one and asks again in 15 minutes; with none it says nothing', async () => {
    let fail = false;
    let calls = 0;
    const fetcher: ListFetcher = async () => { calls += 1; if (fail) throw new Error('http_500'); return ['x/y:free']; };
    await openRouterListed(KEYED, { now: NOW, fetcher });
    fail = true;
    expect([...(await openRouterListed(KEYED, { now: NOW + LIST_TTL_MS + 1, fetcher }))!]).toEqual(['x/y:free']);
    await tick();
    expect([...(await openRouterListed(KEYED, { now: NOW + LIST_TTL_MS + 2, fetcher }))!]).toEqual(['x/y:free']);
    expect(calls).toBe(2);
    await openRouterListed(KEYED, { now: NOW + LIST_TTL_MS + LIST_RETRY_MS + 5, fetcher });
    await tick();
    expect(calls).toBe(3);

    _resetOpenRouterList();
    expect(await openRouterListed(KEYED, { now: NOW, fetcher })).toBeNull();
  });
});

describe('the picker', () => {
  it('a curated OpenRouter model its current list no longer has leaves the picker without a word; an unknown list keeps them all', async () => {
    const s = sanitizeAiSettings({});
    const orIds = MODELS.filter((m) => m.provider === 'openrouter' && APPROVED_MODELS.has(m.id)).map((m) => m.upstream);
    let release: (ids: string[]) => void = () => undefined;
    const fetcher: ListFetcher = () => new Promise((r) => { release = r; });
    const first = await pickerRegistryFor(KEYED, s, { now: NOW, fetcher });
    expect(first.filter((m) => m.provider === 'openrouter').map((m) => m.upstream)).toEqual(orIds);
    const gone = orIds[orIds.length - 1];
    release(orIds.filter((u) => u !== gone));
    await tick();
    const next = await pickerRegistryFor(KEYED, s, { now: NOW + 1, fetcher });
    expect(next.filter((m) => m.provider === 'openrouter').map((m) => m.upstream)).toEqual(orIds.filter((u) => u !== gone));
  });

  it('offers only approved, curated models, and an old `discover` setting changes nothing', async () => {
    const plain = await pickerRegistryFor({} as AiEnv, sanitizeAiSettings({}));
    const old = await pickerRegistryFor({} as AiEnv, sanitizeAiSettings({ discover: true }));
    expect(old.map((m) => m.id)).toEqual(plain.map((m) => m.id));
    expect(plain.every((m) => APPROVED_MODELS.has(m.id) && MODELS.includes(m))).toBe(true);
    expect(sanitizeAiSettings({ discover: true })).not.toHaveProperty('discover');
    expect(PICKER_GROUPS.some((g) => g.startsWith('more-'))).toBe(false);
  });
});

// ---------------------------------------------------------------- the routes

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ADMIN_LOGIN_PASSWORD: 'owner-pass', GROQ_API_KEY: 'gsk_test', ...DB_ENV };
let ip = 0;
const upstreamCalls: string[] = [];
const seed = () => fakeDb({
  accounts: [{ id: '1001', name: 'Asha' }],
  settings: [{ key: 'vinax-ai', value: { enabled: true, discover: true }, updated_at: 'x', updated_by: 'owner' }],
}, (url) => {
  upstreamCalls.push(url);
  return new Response('nope', { status: 404 });
});

describe('routes, with model discovery gone', () => {
  beforeEach(() => { upstreamCalls.length = 0; });

  it('GET /api/ai/models lists no found-model groups, even with an old discover: true', async () => {
    seed();
    const res = await modelsGet({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}` } }), env: ENV as never });
    const body = await res.json() as { groups: string[]; models: Array<{ id: string; group: string }> };
    expect(body.groups.some((g) => g.startsWith('more-'))).toBe(false);
    expect(body.models.every((m) => APPROVED_MODELS.has(m.id))).toBe(true);
    // Nobody's model list was read.
    expect(upstreamCalls.filter((u) => u.endsWith('/models'))).toEqual([]);
  });

  it('POST /api/ai/chat refuses an id that is not curated, before any request', async () => {
    seed();
    const token = await issueSession(ENV, '1001');
    for (const model of ['groq:llama-3.1-8b-instant', 'groq:gemma2-9b-it', 'evil:x', 'groq:']) {
      const res = await chatPost({
        request: new Request('https://www.vinaxmusic.online/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'cf-connecting-ip': `203.0.113.${++ip % 250}` },
          body: JSON.stringify({ conversationId: null, content: [{ type: 'text', text: 'Hello' }], mode: 'model', model, timezone: 'Asia/Kolkata' }),
        }),
        env: ENV as never,
        waitUntil: () => undefined,
      });
      expect(res.status, model).toBe(400);
      expect(await res.json()).toEqual({ error: 'unknown_model' });
    }
    expect(upstreamCalls).toEqual([]);
  });

  it('the console lists the curated registry only, with no discovery card data, and probes only curated ids', async () => {
    seed();
    const adminReq = (body?: unknown) => new Request('https://www.vinaxmusic.online/api/admin/ai', {
      method: body ? 'POST' : 'GET',
      headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const body = await (await adminGet({ request: adminReq(), env: ENV as never })).json() as Record<string, unknown> & { models: Array<{ id: string }> };
    expect(body).not.toHaveProperty('discovery');
    expect(body.models.map((m) => m.id)).toEqual(MODELS.map((m) => m.id));
    expect((await adminPost({ request: adminReq({ model: 'groq:gemma2-9b-it' }), env: ENV as never })).status).toBe(400);
  });
});

describe('names for models no longer in the registry', () => {
  it('prettyName', () => {
    expect(prettyName('openai/gpt-oss-20b')).toBe('GPT OSS 20B');
    expect(prettyName('@cf/qwen/qwq-32b')).toBe('QwQ 32B');
    expect(prettyName('meta-llama/llama-3.3-70b-instruct:free')).toBe('Llama 3.3 70B');
    expect(prettyName('constructor')).toBe('Constructor');
  });
});
