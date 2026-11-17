/**
 * The daily request meter (_lib/cfAnalytics.ts): Cloudflare's GraphQL
 * Analytics read with the read-only key, the ten-minute cache, the answers
 * GET /api/admin/quota gives the console (setup card, data, 502), and the
 * Dashboard's attention item.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsMissing, CF_GRAPHQL_URL, DAILY_REQUEST_ALLOWANCE, readRequestUsage, resetUsageMemo, usageFrom, usageLevel, USAGE_CACHE_MS, USAGE_RETRY_MS,
} from '../functions/_lib/cfAnalytics';
import * as quota from '../functions/api/admin/quota';
import * as overview from '../functions/api/admin/overview';
import { resetAdminMemo } from '../functions/_lib/adminAuth';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { ENV_ITEMS } from '../functions/api/admin/envcheck';

const METER = { CF_ANALYTICS_TOKEN: 'cf-analytics-token', CF_ACCOUNT_ID: 'acc0123' };
const ADMIN = { ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'auth-secret-for-tests' };
/** 17 Nov 2026, 09:30 UTC. */
const NOW = Date.UTC(2026, 10, 17, 9, 30);

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const answer = (rows: Array<{ requests: number; errors?: number; subrequests?: number; scriptName: string; status: string }>) => ({
  data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows.map((r) => ({ sum: { requests: r.requests, errors: r.errors ?? 0, subrequests: r.subrequests ?? 0 }, dimensions: { scriptName: r.scriptName, status: r.status } })) }] } },
  errors: null,
});
const ROWS = [
  { requests: 60_000, errors: 0, subrequests: 90_000, scriptName: 'vinax-api', status: 'success' },
  { requests: 1_500, errors: 1_500, scriptName: 'vinax-api', status: 'scriptThrewException' },
  { requests: 2_500, scriptName: 'other-worker', status: 'success' },
];

let sent: Array<{ url: string; init?: RequestInit }> = [];
function stubFetch(fn: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, init });
    return fn(url, init);
  }));
}

beforeEach(() => { resetUsageMemo(); resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('reading the meter', () => {
  it('adds up every row, and splits by Worker and by outcome (there is no path in this dataset)', () => {
    const u = usageFrom(answer(ROWS), NOW)!;
    expect(u).toMatchObject({ requests: 64_000, errors: 1_500, subrequests: 90_000, allowance: DAILY_REQUEST_ALLOWANCE, share: 0.64, since: '2026-11-17T00:00:00.000Z', resetsAt: '2026-11-18T00:00:00.000Z' });
    expect(u.byScript).toEqual([{ script: 'vinax-api', requests: 61_500, errors: 1_500 }, { script: 'other-worker', requests: 2_500, errors: 0 }]);
    expect(u.byStatus).toEqual([{ status: 'success', requests: 62_500 }, { status: 'scriptThrewException', requests: 1_500 }]);
    expect(usageFrom({ data: { viewer: { accounts: [] } } }, NOW)).toBeNull();
    expect(usageFrom(answer([]), NOW)).toMatchObject({ requests: 0, share: 0 });
    expect([usageLevel(0.5), usageLevel(0.8), usageLevel(0.95)]).toEqual(['ok', 'warn', 'bad']);
  });

  it('asks Cloudflare once with the read-only key for today since 00:00 UTC, then serves the cache for ten minutes', async () => {
    stubFetch(() => json(answer(ROWS)));
    const r = await readRequestUsage(METER, NOW);
    expect(r).toMatchObject({ ok: true, cached: false, usage: { requests: 64_000 } });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(CF_GRAPHQL_URL);
    expect((sent[0].init?.headers as Record<string, string>).authorization).toBe('Bearer cf-analytics-token');
    const body = JSON.parse(String(sent[0].init?.body)) as { query: string; variables: Record<string, string> };
    expect(body.query).toContain('workersInvocationsAdaptive');
    expect(body.variables).toEqual({ accountTag: 'acc0123', since: '2026-11-17T00:00:00.000Z', until: new Date(NOW).toISOString() });
    expect(await readRequestUsage(METER, NOW + USAGE_CACHE_MS - 1)).toMatchObject({ ok: true, cached: true });
    expect(sent).toHaveLength(1);
    await readRequestUsage(METER, NOW + USAGE_CACHE_MS);
    expect(sent).toHaveLength(2);
  });

  it('a short wait that times out (the Dashboard) does not hold back the next full read', async () => {
    let slow = true;
    stubFetch((_url, init) => (slow
      ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
      : json(answer(ROWS))));
    expect(await readRequestUsage(METER, NOW, { timeoutMs: 5 })).toEqual({ ok: false, reason: 'timeout' });
    slow = false;
    expect(await readRequestUsage(METER, NOW + 1_000)).toMatchObject({ ok: true, cached: false });
    expect(sent).toHaveLength(2);
  });

  it('a new UTC day starts a new count', async () => {
    stubFetch(() => json(answer(ROWS)));
    await readRequestUsage(METER, Date.UTC(2026, 10, 17, 23, 58));
    const r = await readRequestUsage(METER, Date.UTC(2026, 10, 18, 0, 1));
    expect(sent).toHaveLength(2);
    expect(r.ok && r.usage.since).toBe('2026-11-18T00:00:00.000Z');
  });

  it('says why it failed, and waits two minutes before asking again', async () => {
    expect(await readRequestUsage({}, NOW)).toEqual({ ok: false, reason: 'not_configured' });
    expect(analyticsMissing({ CF_ANALYTICS_TOKEN: ' ' })).toEqual(['CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID']);
    stubFetch(() => json({ success: false, errors: [{ message: 'Invalid API Token' }] }, 401));
    expect(await readRequestUsage(METER, NOW)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await readRequestUsage(METER, NOW + USAGE_RETRY_MS - 1)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(sent).toHaveLength(1);
    resetUsageMemo();
    stubFetch(() => json({ data: null, errors: [{ message: 'not authorized for that account' }] }));
    expect(await readRequestUsage(METER, NOW)).toEqual({ ok: false, reason: 'unauthorized' });
    resetUsageMemo();
    stubFetch(() => json({ data: { viewer: { accounts: [] } }, errors: null })); // a wrong account id
    expect(await readRequestUsage(METER, NOW)).toEqual({ ok: false, reason: 'unauthorized' });
    resetUsageMemo();
    stubFetch(() => new Response('bad gateway', { status: 502 }));
    expect(await readRequestUsage(METER, NOW)).toEqual({ ok: false, reason: 'failed' });
    resetUsageMemo();
    stubFetch(() => { throw new Error('network down'); });
    expect(await readRequestUsage(METER, NOW)).toEqual({ ok: false, reason: 'failed' });
  });
});

type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const get = async (h: unknown, path: string, env: Record<string, unknown>, token: string | null = 'owner-pass') => {
  const res = await (h as H)({ request: new Request(`https://admin.vinaxmusic.online${path}`, { headers: { 'cf-connecting-ip': '203.0.113.7', ...(token ? { 'x-admin-token': token } : {}) } }), env });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

describe('GET /api/admin/quota', () => {
  it('needs an admin, not the database; without the keys it is the setup answer', async () => {
    expect((await get(quota.onRequestGet, '/api/admin/quota', ADMIN, null)).status).toBe(401);
    const r = await get(quota.onRequestGet, '/api/admin/quota', ADMIN);
    expect(r).toEqual({ status: 200, body: { configured: false, missing: ['CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID'], allowance: 100_000 } });
  });

  it('answers the meter with its level, or a 502 the console shows as "Could not load"', async () => {
    stubFetch(() => json(answer([{ requests: 86_000, scriptName: 'vinax-api', status: 'success' }])));
    const ok = await get(quota.onRequestGet, '/api/admin/quota', { ...ADMIN, ...METER });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ configured: true, requests: 86_000, allowance: 100_000, level: 'warn', byScript: [{ script: 'vinax-api', requests: 86_000 }] });
    resetUsageMemo();
    stubFetch(() => json({}, 403));
    const bad = await get(quota.onRequestGet, '/api/admin/quota', { ...ADMIN, ...METER });
    expect(bad.status).toBe(502);
    expect(bad.body).toMatchObject({ configured: true, error: 'cf_unauthorized' });
    expect(String(bad.body?.message)).toContain('Account Analytics');
  });

  it('API Keys Status lists both keys', () => {
    expect(ENV_ITEMS.filter((i) => i.name.startsWith('CF_')).map((i) => [i.name, i.group, i.required])).toEqual([['CF_ANALYTICS_TOKEN', 'Monitoring', false], ['CF_ACCOUNT_ID', 'Monitoring', false]]);
  });
});

describe('the Dashboard', () => {
  it('warns from 80% of the allowance, urgently from 95%, and opens Server Checks', () => {
    const schema = { version: 99 };
    const k = { pushDevices: 3 };
    expect(overview.attentionFor(k, schema, { used: 79_999, allowance: 100_000 })).toEqual([]);
    expect(overview.attentionFor(k, schema, { used: 81_000, allowance: 100_000 })).toEqual([
      { id: 'requests', level: 'warn', text: '81% of today\'s 1,00,000 server requests are used. At 100% the app stops working until 05:30 India time.', action: 'See requests', page: 'server-checks' },
    ]);
    expect(overview.attentionFor(k, schema, { used: 96_000, allowance: 100_000 })[0]).toMatchObject({ id: 'requests', level: 'bad' });
    expect(overview.attentionFor(k, schema, null)).toEqual([]);
  });

  it('reads the meter beside the numbers when it is set up, and a failed meter is no item', async () => {
    const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
    let meter: () => Response = () => json(answer([{ requests: 97_000, scriptName: 'vinax-api', status: 'success' }]));
    stubFetch((url) => {
      if (url === CF_GRAPHQL_URL) return meter();
      const p = new URL(url).pathname.replace('/rest/v1/', '');
      if (p === 'rpc/stats_overview') return json({ pushDevices: 3 });
      if (p === 'rpc/stats_timeline') return json([]);
      if (p === 'rpc/stats_platforms') return json({ platforms: [], versions: [] });
      if (p === 'meta') return json([{ key: 'schema', value: { version: 99 } }]);
      return json([]);
    });
    const r = await get(overview.onRequestGet, '/api/admin/overview', { ...ADMIN, ...DB, ...METER });
    expect(r.status).toBe(200);
    expect(r.body?.attention).toEqual([expect.objectContaining({ id: 'requests', level: 'bad', page: 'server-checks' })]);
    resetUsageMemo();
    meter = () => json({}, 500);
    const failed = await get(overview.onRequestGet, '/api/admin/overview', { ...ADMIN, ...DB, ...METER });
    expect(failed.status).toBe(200);
    expect(failed.body?.attention).toEqual([]);
    resetUsageMemo();
    sent = [];
    const without = await get(overview.onRequestGet, '/api/admin/overview', { ...ADMIN, ...DB });
    expect(without.body?.attention).toEqual([]);
    expect(sent.filter((s) => s.url === CF_GRAPHQL_URL)).toHaveLength(0);
  });
});
