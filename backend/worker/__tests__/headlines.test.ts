/**
 * 11.9 — "Trending now" headlines: the scheduled refresh (one search per
 * topic, fixed queries, stored once), its credit guards (75 % share of the
 * daily cap, the owner's web-search switch), keeping a topic's previous
 * headlines when its search fails, the public read (never searches, hides
 * stale or switched-off headlines) and the cron endpoint's secret.
 * fetch is mocked everywhere: no test reaches Serper or the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentHeadlines, readHeadlinesDoc, refreshHeadlines, resetHeadlinesCache, HEADLINES_KEY } from '../functions/_lib/headlines';
import { resetSerperState } from '../functions/_lib/serper';
import { resetAiControlsCache } from '../functions/_lib/ai';

const ENV = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SERPER_API_KEY: 'serper-key', CRON_SECRET: 'cron-secret' };

interface World {
  stored?: unknown;
  controls?: unknown;
  todayCount?: number;
  serper?: (q: string) => Response;
}
interface Call { url: string; method: string; body: Record<string, unknown> | null }

function install(w: World): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null; } catch { /* not JSON */ }
    calls.push({ url, method, body });
    const json = (o: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.startsWith('https://google.serper.dev/')) return w.serper ? w.serper(String(body?.q ?? '')) : json({ news: [{ title: `Story for ${String(body?.q)}`, link: `https://news.example.com/${encodeURIComponent(String(body?.q))}` }] });
    if (url.includes('/rest/v1/vinax_config') && method === 'GET') {
      if (url.includes('ai-controls')) return json(w.controls ? [{ key: 'ai-controls', value: w.controls }] : []);
      return json(w.stored ? [{ value: w.stored }] : []);
    }
    if (url.includes('/rest/v1/vinax_ai_events') && method === 'GET') return json([], 200, { 'content-range': `0-0/${w.todayCount ?? 0}` });
    return json([], 201);
  }));
  return calls;
}
const serperCalls = (c: Call[]): Call[] => c.filter((x) => x.url.startsWith('https://google.serper.dev/'));
const upserts = (c: Call[]): Call[] => c.filter((x) => x.url.includes('/rest/v1/vinax_config') && x.method === 'POST');

beforeEach(() => {
  resetSerperState();
  resetHeadlinesCache();
  resetAiControlsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('refreshHeadlines', () => {
  it('runs one fixed news search per topic and stores the result once', async () => {
    const calls = install({});
    const out = await refreshHeadlines(ENV);
    expect(out).toEqual({ ok: true, topics: { india: 1, tech: 1 }, stored: true });
    const s = serperCalls(calls);
    expect(s.map((c) => c.url)).toEqual(['https://google.serper.dev/news', 'https://google.serper.dev/news']);
    expect(s.map((c) => c.body?.q)).toEqual(['India top news today', 'technology news today']);
    expect(s.every((c) => c.body?.gl === 'in' && c.body?.hl === 'en')).toBe(true);
    const up = upserts(calls);
    expect(up).toHaveLength(1);
    expect(up[0].body).toMatchObject({ key: HEADLINES_KEY });
    const doc = readHeadlinesDoc((up[0].body as { value: unknown }).value);
    expect(doc?.topics.map((t) => [t.id, t.items.length])).toEqual([['india', 1], ['tech', 1]]);
    expect(doc?.topics[0].items[0].site).toBe('news.example.com');
  });

  it('stops at 75 % of the daily cap, so listeners keep the rest', async () => {
    const calls = install({ todayCount: 60 }); // 60 of the default 80 = 75 %
    expect(await refreshHeadlines(ENV)).toEqual({ ok: false, reason: 'no_results' });
    expect(serperCalls(calls)).toHaveLength(0);
    expect(upserts(calls)).toHaveLength(0);
  });

  it('does nothing when the owner switched web-search off, or without a key', async () => {
    let calls = install({ controls: { features: { 'web-search': false } } });
    expect(await refreshHeadlines(ENV)).toEqual({ ok: false, reason: 'disabled' });
    expect(serperCalls(calls)).toHaveLength(0);
    resetAiControlsCache();
    calls = install({ controls: { emergencyOff: true } });
    expect(await refreshHeadlines(ENV)).toEqual({ ok: false, reason: 'disabled' });
    expect(serperCalls(calls)).toHaveLength(0);
    calls = install({});
    expect(await refreshHeadlines({ ...ENV, SERPER_API_KEY: '' })).toEqual({ ok: false, reason: 'not_configured' });
    expect(serperCalls(calls)).toHaveLength(0);
  });

  it('a topic whose search fails keeps its previous headlines', async () => {
    const previous = { updatedAt: '2026-10-13T00:00:00.000Z', topics: [{ id: 'india', items: [] }, { id: 'tech', items: [{ title: 'Old tech story', url: 'https://tech.example/old' }] }] };
    const calls = install({ stored: previous, serper: (q) => (q.startsWith('technology') ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ news: [{ title: 'New India story', link: 'https://in.example/new' }] }), { status: 200 })) });
    const out = await refreshHeadlines(ENV);
    expect(out).toMatchObject({ ok: true, topics: { india: 1, tech: 0 } });
    const doc = readHeadlinesDoc((upserts(calls)[0].body as { value: unknown }).value);
    expect(doc?.topics.find((t) => t.id === 'tech')?.items[0].title).toBe('Old tech story');
    expect(doc?.topics.find((t) => t.id === 'india')?.items[0].title).toBe('New India story');
  });
});

describe('currentHeadlines and GET /api/ai/headlines', () => {
  const fresh = (): unknown => ({ updatedAt: new Date().toISOString(), topics: [{ id: 'india', items: [{ title: 'A <b>story</b>', url: 'https://a.example/1' }, { title: 'bad', url: 'javascript:alert(1)' }] }, { id: 'tech', items: [] }] });

  it('reads the stored row, validated, and never searches', async () => {
    const calls = install({ stored: fresh() });
    const doc = await currentHeadlines(ENV);
    expect(doc?.topics[0].items).toEqual([{ title: 'A <b>story</b>', url: 'https://a.example/1', site: 'a.example' }]);
    expect(serperCalls(calls)).toHaveLength(0);
    const { onRequestGet } = await import('../functions/api/ai/headlines');
    resetHeadlinesCache();
    const res = await onRequestGet({ env: ENV });
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
    const body = (await res.json()) as { topics: Array<{ items: unknown[] }> };
    expect(body.topics[0].items).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('serper-key');
  });

  it('shows nothing when the headlines are older than a day, or web-search is off', async () => {
    install({ stored: { updatedAt: '2026-01-01T00:00:00.000Z', topics: [{ id: 'india', items: [{ title: 'x', url: 'https://a.example/' }] }] } });
    expect(await currentHeadlines(ENV)).toBeNull();
    resetHeadlinesCache();
    resetAiControlsCache();
    install({ stored: fresh(), controls: { features: { 'web-search': false } } });
    expect(await currentHeadlines(ENV)).toBeNull();
    const { onRequestGet } = await import('../functions/api/ai/headlines');
    expect(await (await onRequestGet({ env: ENV })).json()).toEqual({ topics: [] });
  });
});

describe('POST /api/cron/headlines', () => {
  const post = (secret?: string, method = 'POST'): Request => new Request('https://example.test/api/cron/headlines', { method, headers: secret ? { 'x-cron-secret': secret } : {} });

  it('needs the cron secret and POST; reports a skip as success', async () => {
    const calls = install({ controls: { features: { 'web-search': false } } });
    const { onRequest } = await import('../functions/api/cron/headlines');
    expect((await onRequest({ request: post(), env: ENV })).status).toBe(401);
    expect((await onRequest({ request: post('wrong'), env: ENV })).status).toBe(401);
    expect((await onRequest({ request: post('cron-secret', 'GET'), env: ENV })).status).toBe(405);
    const ok = await onRequest({ request: post('cron-secret'), env: ENV });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, skipped: 'disabled' });
    expect(serperCalls(calls)).toHaveLength(0);
  });

  it('refreshes with the right secret', async () => {
    const calls = install({});
    const { onRequest } = await import('../functions/api/cron/headlines');
    const res = await onRequest({ request: post('cron-secret'), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, topics: { india: 1, tech: 1 } });
    expect(serperCalls(calls)).toHaveLength(2);
  });
});
