/**
 * Owner console — Test search (POST /api/admin/ai-search, search.ts
 * testSearch): one real search through whichever provider is set, cache
 * skipped, counted against the daily allowance; what it reports on success
 * and on each kind of failure; editors and owners only; never the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { onRequestPost } from '../functions/api/admin/ai-search';
import { onRequestGet as adminGet } from '../functions/api/admin/ai';
import { _resetSearch, searchWeb, testSearch, TEST_QUERY } from '../functions/_lib/ai/search';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import type { AiEnv } from '../functions/_lib/ai/types';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';

const ENV = { ADMIN_LOGIN_PASSWORD: 'owner-pass', SEARCH_API_KEY: 'tvly-secret-key', ...DB_ENV };
let ip = 0;
let fake: FakeDb;
let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => Response | Promise<Response>;
let taken: boolean;
let store: Map<string, Response>;

const tavilyOk = () => Response.json({ results: [
  { url: 'https://www.example.org/ragas', title: 'Ragas', content: 'A raga is…' },
  { url: 'https://music.example.com/carnatic', title: 'Carnatic', content: '…' },
] });

beforeEach(() => {
  _resetSearch();
  resetSettingsMemo();
  _resetRateLimitsForTests();
  calls = [];
  taken = true;
  store = new Map();
  answer = tavilyOk;
  fake = fakeDb({}, (url, init) => { calls.push({ url, init }); return answer(url); });
  fake.answer('rpc/ai_take_daily', () => Response.json(taken));
  vi.stubGlobal('caches', { default: { match: async (k: string) => store.get(k)?.clone(), put: async (k: string, r: Response) => { store.set(k, r); } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('testSearch', () => {
  it('Tavily: one real search, its count, time, provider and first site; one taken from the allowance', async () => {
    const r = await testSearch({ ...ENV } as AiEnv);
    expect(r).toMatchObject({ ok: true, provider: 'tavily', count: 2, status: 200, site: 'example.org' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ query: TEST_QUERY, topic: 'general' });
    expect(fake.calls.find((c) => c.table === 'rpc/ai_take_daily')?.body).toEqual({ p_kind: 'search', p_limit: 100 });
  });

  it('skips the cache: an answer the chat cached does not stand in for the test', async () => {
    const env = { ...ENV } as AiEnv;
    await searchWeb(env, TEST_QUERY, 'general');
    expect(calls).toHaveLength(1);
    await testSearch(env);
    expect(calls).toHaveLength(2);
    expect(fake.calls.filter((c) => c.table === 'rpc/ai_take_daily')).toHaveLength(2);
  });

  it('Serper when SEARCH_API_PROVIDER says so', async () => {
    answer = () => Response.json({ organic: [{ link: 'https://s.example.net/x', title: 'X', snippet: 's' }] });
    const r = await testSearch({ ...ENV, SEARCH_API_PROVIDER: 'serper' } as AiEnv, { query: 'tabla basics' });
    expect(r).toMatchObject({ ok: true, provider: 'serper', count: 1, site: 's.example.net' });
    expect(calls[0].url).toBe('https://google.serper.dev/search');
    expect((calls[0].init?.headers as Record<string, string>)['X-API-KEY']).toBe('tvly-secret-key');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ q: 'tabla basics' });
  });

  it('not configured, or today’s allowance used up: the provider is never asked', async () => {
    expect(await testSearch({ ...DB_ENV } as AiEnv)).toMatchObject({ ok: false, reason: 'not_configured', count: 0 });
    expect(await testSearch({ ...ENV } as AiEnv, { ownerCap: 0 })).toMatchObject({ ok: false, reason: 'not_configured' });
    taken = false;
    expect(await testSearch({ ...ENV } as AiEnv)).toMatchObject({ ok: false, reason: 'daily_limit' });
    expect(calls).toHaveLength(0);
  });

  it('a refused key reports its status and rests the provider; a later good test ends the rest', async () => {
    answer = () => new Response('{"detail":"Unauthorized: missing or invalid API key."}', { status: 401 });
    const env = { ...ENV } as AiEnv;
    expect(await testSearch(env)).toMatchObject({ ok: false, reason: 'failed', status: 401, provider: 'tavily' });
    expect(await searchWeb(env, 'news today', 'news')).toEqual({ ok: false, reason: 'resting' });
    answer = tavilyOk;
    expect(await testSearch(env)).toMatchObject({ ok: true });
    expect(await searchWeb(env, 'news today', 'news')).toMatchObject({ ok: true });
  });

  it('an answer with no results, and a network failure', async () => {
    answer = () => Response.json({ results: [] });
    expect(await testSearch({ ...ENV } as AiEnv)).toMatchObject({ ok: false, reason: 'empty', status: 200 });
    answer = () => { throw new TypeError('network down'); };
    expect(await testSearch({ ...ENV } as AiEnv)).toMatchObject({ ok: false, reason: 'failed', status: null });
  });
});

describe('POST /api/admin/ai-search', () => {
  const req = (body: unknown = {}, token: string | null = 'owner-pass') => new Request('https://www.vinaxmusic.online/api/admin/ai-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(token ? { 'x-admin-token': token } : {}) },
    body: JSON.stringify(body),
  });

  it('runs one search and never returns the key', async () => {
    const res = await onRequestPost({ request: req(), env: ENV as never });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('tvly-secret-key');
    expect(JSON.parse(text)).toMatchObject({ ok: true, provider: 'tavily', count: 2 });
  });

  it('uses the owner’s searches a day when set', async () => {
    fake.tables.settings = [{ key: 'vinax-ai', value: { limits: { searchesPerDay: 7 } }, updated_at: 'x', updated_by: 'owner' }];
    await onRequestPost({ request: req({ topic: 'news' }), env: ENV as never });
    expect(fake.calls.find((c) => c.table === 'rpc/ai_take_daily')?.body).toEqual({ p_kind: 'search', p_limit: 7 });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ topic: 'news' });
  });

  it('GET /api/admin/ai shows the same allowance the test counts against (the owner’s, when set)', async () => {
    fake.tables.settings = [{ key: 'vinax-ai', value: { limits: { searchesPerDay: 7 } }, updated_at: 'x', updated_by: 'owner' }];
    const res = await adminGet({ request: new Request('https://www.vinaxmusic.online/api/admin/ai', { headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': `203.0.113.${++ip % 250}` } }), env: ENV as never });
    expect(((await res.json()) as { search: { api: unknown } }).search.api).toMatchObject({ configured: true, provider: 'tavily', dailyLimit: 7 });
    resetSettingsMemo();
    fake.tables.settings = [{ key: 'vinax-ai', value: { limits: { searchesPerDay: 0 } }, updated_at: 'x', updated_by: 'owner' }];
    const off = await adminGet({ request: new Request('https://www.vinaxmusic.online/api/admin/ai', { headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': `203.0.113.${++ip % 250}` } }), env: ENV as never });
    expect(((await off.json()) as { search: { api: unknown } }).search.api).toMatchObject({ configured: false, dailyLimit: 0 });
  });

  it('owner sign-in needed; a bad body is refused', async () => {
    expect((await onRequestPost({ request: req({}, null), env: ENV as never })).status).toBe(401);
    expect((await onRequestPost({ request: req({ topic: 'images' }), env: ENV as never })).status).toBe(400);
    expect((await onRequestPost({ request: req({ query: 5 }), env: ENV as never })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('reaches its handler through the Worker’s router', async () => {
    const res = await worker.fetch(req(), { ...ENV, ASSETS_HOST: 'vinax.pages.dev' } as never, { waitUntil: () => undefined } as never);
    expect(res.status).toBe(200);
  });
});
