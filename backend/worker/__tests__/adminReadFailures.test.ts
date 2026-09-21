/**
 * 7.2.0 — a failed database read is not zero. Drives the REAL admin handlers
 * with a stubbed database REST layer: an upstream 500 / 401 / network failure
 * must answer non-2xx (502) naming the failure, never a 200 with zeros or
 * empty lists; panels with independent parts answer 200 with the failed part
 * null and named in `unavailable`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as overview } from '../functions/api/admin/overview';
import { onRequestGet as realtime } from '../functions/api/admin/realtime';
import { onRequestGet as users } from '../functions/api/admin/users';
import { onRequestGet as engagement } from '../functions/api/admin/engagement';
import { onRequestGet as aicost } from '../functions/api/admin/aicost';
import { onRequestGet as audit } from '../functions/api/admin/audit';
import { onRequestGet as skips } from '../functions/api/admin/skips';
import { onRequestGet as searchAnalytics } from '../functions/api/admin/search-analytics';
import { onRequestGet as experiments } from '../functions/api/admin/experiments';
import { onRequestGet as activity } from '../functions/api/admin/activity';
import { onRequestGet as aiMetrics } from '../functions/api/admin/ai';
import { onRequestGet as ailab } from '../functions/api/admin/ailab';
import { onRequestGet as appconfig } from '../functions/api/admin/appconfig';
import { onRequestGet as content } from '../functions/api/admin/content';
import { onRequestGet as digest } from '../functions/api/admin/digest';
import { onRequestGet as feedback } from '../functions/api/admin/feedback';
import { onRequestGet as funnel } from '../functions/api/admin/funnel';
import { onRequestGet as growth } from '../functions/api/admin/growth';
import { onRequestGet as insights } from '../functions/api/admin/insights';
import { onRequestGet as live } from '../functions/api/admin/live';
import { onRequestGet as location } from '../functions/api/admin/location';
import { onRequestGet as music } from '../functions/api/admin/music';
import { onRequestGet as notifylog } from '../functions/api/admin/notifylog';
import { onRequestGet as pushGet, onRequestPost as pushPost } from '../functions/api/admin/push';
import { onRequestGet as retention } from '../functions/api/admin/retention';
import { onRequestGet as rooms } from '../functions/api/admin/rooms';
import { onRequestGet as seo } from '../functions/api/admin/seo';
import { onRequestGet as songstats } from '../functions/api/admin/songstats';
import { onRequestGet as usage } from '../functions/api/admin/usage';
import { onRequestGet as user } from '../functions/api/admin/user';
import { onRequestGet as technical } from '../functions/api/admin/technical';
import { onRequestGet as tables } from '../functions/api/admin/tables';
import { onRequestGet as cron } from '../functions/api/admin/cron';
import { onRequestGet as dataquality } from '../functions/api/admin/dataquality';
import { onRequestGet as health } from '../functions/api/admin/health';

const ENV = {
  ADMIN_LOGIN_PASSWORD: 'test-secret',
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  VAPID_PUBLIC_KEY: 'pk',
  VAPID_PRIVATE_KEY: 'sk',
  VAPID_SUBJECT: 'mailto:x@y.z',
};

type Handler = (ctx: { request: Request; env: typeof ENV }) => Promise<Response>;
interface Call { url: string; method: string }
const calls: Call[] = [];

/** Default: every database call answers `status`; routes override by URL substring. */
function upstream(status: number, routes: Array<[string, () => Response]> = [], body = '{"message":"boom"}'): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    for (const [needle, make] of routes) if (url.includes(needle)) return Promise.resolve(make());
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }));
  });
}
const ok = (body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const fail = (status: number) => () => new Response('{"message":"boom"}', { status });

let ipSeq = 0;
function req(path: string, method = 'GET', body?: unknown, token = 'test-secret'): Request {
  ipSeq += 1;
  return new Request(`https://admin.test${path}`, {
    method,
    headers: { 'x-admin-token': token, 'content-type': 'application/json', 'cf-connecting-ip': `10.12.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

/** Every dashboard whose numbers come from one or more REQUIRED reads. */
const REQUIRED: Array<[string, Handler, string]> = [
  ['overview', overview, '/api/admin/overview'],
  ['realtime', realtime, '/api/admin/realtime'],
  ['users', users, '/api/admin/users'],
  ['engagement', engagement, '/api/admin/engagement?days=7'],
  ['aicost', aicost, '/api/admin/aicost?days=7'],
  ['audit', audit, '/api/admin/audit'],
  ['skips', skips, '/api/admin/skips?days=7'],
  ['search-analytics', searchAnalytics, '/api/admin/search-analytics?days=7'],
  ['experiments', experiments, '/api/admin/experiments'],
  ['activity', activity, '/api/admin/activity'],
  ['ai', aiMetrics, '/api/admin/ai?days=7'],
  ['ailab', ailab, '/api/admin/ailab'],
  ['appconfig', appconfig, '/api/admin/appconfig?key=flags'],
  ['content', content, '/api/admin/content'],
  ['digest', digest, '/api/admin/digest'],
  ['feedback', feedback, '/api/admin/feedback'],
  ['funnel', funnel, '/api/admin/funnel?days=7'],
  ['growth', growth, '/api/admin/growth'],
  ['insights', insights, '/api/admin/insights?days=7'],
  ['live', live, '/api/admin/live'],
  ['location', location, '/api/admin/location?days=7'],
  ['music', music, '/api/admin/music?days=7'],
  ['notifylog', notifylog, '/api/admin/notifylog'],
  ['push', pushGet, '/api/admin/push'],
  ['retention', retention, '/api/admin/retention'],
  ['rooms', rooms, '/api/admin/rooms'],
  ['seo', seo, '/api/admin/seo'],
  ['songstats', songstats, '/api/admin/songstats?q=abc123XYZ&days=7'],
  ['usage', usage, '/api/admin/usage?days=7'],
  ['user', user, '/api/admin/user?deviceId=dev-1'],
];

/** True when the JSON carries a numeric 0 or an empty array anywhere — the old failure shape. */
function carriesZeroOrEmpty(v: unknown): boolean {
  if (v === 0) return true;
  if (Array.isArray(v)) return v.length === 0 || v.some(carriesZeroOrEmpty);
  if (v && typeof v === 'object') return Object.values(v).some(carriesZeroOrEmpty);
  return false;
}

describe('required reads — an upstream 500 answers 502, never a 200 with zeros', () => {
  it.each(REQUIRED)('%s', async (_name, handler, path) => {
    upstream(500);
    const res = await handler({ request: req(path), env: ENV });
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.error).toBe('db_unavailable');
    expect(body.upstreamStatus).toBe(500);
    // Nothing that could be mistaken for data rides along with the failure
    // (the SEO panel's live sitemap probe is independent of the database).
    const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !['configured', 'error', 'upstreamStatus', 'key', 'sitemap'].includes(k)));
    expect(carriesZeroOrEmpty(rest)).toBe(false);
  });
});

describe('required reads — a refused service key is named, distinct from an outage', () => {
  it.each(REQUIRED)('%s', async (_name, handler, path) => {
    upstream(401, [], '{"message":"JWT expired"}');
    const res = await handler({ request: req(path), env: ENV });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string; upstreamStatus?: number };
    expect(body.error).toBe('db_unauthorized');
    expect(body.upstreamStatus).toBe(401);
  });
});

describe('required reads — a wrong admin token is still a plain 401 that reads nothing', () => {
  it.each(REQUIRED)('%s', async (_name, handler, path) => {
    upstream(500);
    const res = await handler({ request: req(path, 'GET', undefined, 'wrong-token'), env: ENV });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('not configured keeps its configured:false answer', () => {
  it.each(REQUIRED)('%s', async (_name, handler, path) => {
    upstream(500);
    const res = await handler({ request: req(path), env: { ADMIN_LOGIN_PASSWORD: 'test-secret' } as typeof ENV });
    // push GET reports push configuration, not database configuration.
    if (_name === 'push') {
      expect(res.status).toBe(200);
      return;
    }
    expect(res.status).toBe(200);
    expect(((await res.json()) as { configured?: boolean }).configured).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('healthy reads are unchanged', () => {
  it('overview answers 200 with the real numbers', async () => {
    upstream(200, [
      ['rpc/vinax_overview', ok({ active_now: 3, total_users: 10, new_today: 1, plays_today: 7, plays_7d: 20, errors_24h: 0, dau: 4, wau: 6, mau: 9, feedback_new: 0 })],
      ['rpc/vinax_geo', ok([{ country: 'IN', city: 'X', listeners: 2, plays: 3 }])],
    ], '[]');
    const res = await overview({ request: req('/api/admin/overview'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { plays_today: number }; topCountries: Array<{ country: string }> };
    expect(body.summary.plays_today).toBe(7);
    expect(body.topCountries[0].country).toBe('IN');
  });

  it('an empty events table is still an honest 200 with zero plays', async () => {
    upstream(200, [], '[]');
    const res = await engagement({ request: req('/api/admin/engagement?days=7'), env: ENV });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plays: number }).plays).toBe(0);
  });

  it('a missing rollup falls back to the sample, which says so', async () => {
    upstream(200, [['rpc/vinax_skips', fail(404)]], '[]');
    const res = await skips({ request: req('/api/admin/skips?days=7'), env: ENV });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { source: string }).source).toBe('sampled');
  });

  it('a missing retention function is the documented configured:false, an outage is 502', async () => {
    upstream(200, [['rpc/vinax_retention', fail(404)]], '[]');
    const missing = await retention({ request: req('/api/admin/retention'), env: ENV });
    expect(missing.status).toBe(200);
    expect(((await missing.json()) as { configured: boolean }).configured).toBe(false);
    upstream(200, [['rpc/vinax_retention', fail(503)]], '[]');
    expect((await retention({ request: req('/api/admin/retention'), env: ENV })).status).toBe(502);
  });

  it('a missing experiments table is configured:false; an outage on it is 502 (was configured:false)', async () => {
    upstream(200, [['vinax_experiments', fail(404)]], '[]');
    const missing = await experiments({ request: req('/api/admin/experiments'), env: ENV });
    expect(((await missing.json()) as { configured: boolean }).configured).toBe(false);
    upstream(200, [['vinax_experiments', fail(500)]], '[]');
    expect((await experiments({ request: req('/api/admin/experiments'), env: ENV })).status).toBe(502);
  });
});

describe('panels with independent parts — the failed part is null and named, never 0', () => {
  it('technical: a failed vitals read nulls only the vitals; the rest still renders', async () => {
    upstream(200, [
      ['type=eq.vital', fail(500)],
      ['rpc/vinax_tech_summary', ok({ errors_24h: 2, plays_24h: 5, active_sessions: 1, versions: 1 })],
    ], '[]');
    const res = await technical({ request: req('/api/admin/technical?days=7'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vitals: unknown; summary: { errors_24h: number }; unavailable: string[]; errors: unknown[] };
    expect(body.vitals).toBeNull();
    expect(body.unavailable).toEqual(['vitals']);
    expect(body.summary.errors_24h).toBe(2);
    expect(body.errors).toEqual([]);
  });

  it('technical: every part failing is a 502', async () => {
    upstream(500);
    const res = await technical({ request: req('/api/admin/technical?days=7'), env: ENV });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { unavailable: string[] }).unavailable).toHaveLength(6);
  });

  it('technical: a refused key on one part names that part unauthorized-failed, not zero', async () => {
    upstream(200, [['rpc/vinax_tech_summary', fail(403)]], '[]');
    const body = (await (await technical({ request: req('/api/admin/technical?days=7'), env: ENV })).json()) as { summary: unknown; unavailable: string[] };
    expect(body.summary).toBeNull();
    expect(body.unavailable).toEqual(['summary']);
  });

  it('tables: one unreadable table is readable:false with null counts; the total is unknown', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('vinax_rooms')) return Promise.resolve(fail(500)());
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '0-0/5' } }));
    });
    const res = await tables({ request: req('/api/admin/tables'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRows: number | null; tables: Array<{ name: string; total: number | null; readable: boolean; error?: string }>; unavailable: string[] };
    const rooms = body.tables.find((t) => t.name === 'vinax_rooms');
    expect(rooms?.total).toBeNull();
    expect(rooms?.readable).toBe(false);
    expect(rooms?.error).toBe('unavailable');
    expect(body.tables.find((t) => t.name === 'vinax_events')?.total).toBe(5);
    expect(body.totalRows).toBeNull();
    expect(body.unavailable).toEqual(['vinax_rooms']);
  });

  it('tables: a count without a usable content-range is unavailable, not 0', async () => {
    upstream(200, [], '[]');
    const res = await tables({ request: req('/api/admin/tables'), env: ENV });
    expect(res.status).toBe(502);
  });

  it('cron: an unreadable job is unknown (ok:null), not overdue; all unreadable is 502', async () => {
    upstream(200, [['type=eq.song-push', fail(500)]], '[]');
    const res = await cron({ request: req('/api/admin/cron'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<{ id: string; ok: boolean | null; readable: boolean }>; unavailable: string[] };
    const job = body.jobs.find((j) => j.id === 'song-push');
    expect(job?.ok).toBeNull();
    expect(job?.readable).toBe(false);
    expect(body.unavailable).toEqual(['song-push']);
    upstream(500);
    expect((await cron({ request: req('/api/admin/cron'), env: ENV })).status).toBe(502);
  });

  it('dataquality: a failed AI sample nulls the AI metrics and its sample size; both failing is 502', async () => {
    upstream(200, [['vinax_ai_events', fail(500)]], '[{"origin_verified":true,"country":"IN"}]');
    const res = await dataquality({ request: req('/api/admin/dataquality'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { metrics: Record<string, number | null>; sampled: { events: number | null; aiEvents: number | null }; unavailable: string[] };
    expect(body.metrics.aiOkPct).toBeNull();
    expect(body.metrics.originVerifiedPct).toBe(100);
    expect(body.sampled.aiEvents).toBeNull();
    expect(body.unavailable).toEqual(['aiEvents']);
    upstream(500);
    expect((await dataquality({ request: req('/api/admin/dataquality'), env: ENV })).status).toBe(502);
  });

  it('experiments: a failed metrics read keeps the list and nulls the metrics', async () => {
    upstream(200, [
      ['vinax_experiments', ok([{ key: 'e1', name: 'E1', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }], active: true, created_at: '2026-09-01T00:00:00Z' }])],
      ['vinax_events', fail(500)],
    ], '[]');
    const res = await experiments({ request: req('/api/admin/experiments'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { experiments: Array<{ key: string; metrics: unknown }>; sampledEvents: number | null; unavailable: string[] };
    expect(body.experiments[0].key).toBe('e1');
    expect(body.experiments[0].metrics).toBeNull();
    expect(body.sampledEvents).toBeNull();
    expect(body.unavailable).toEqual(['metrics']);
  });

  it('health: the database half names its failure instead of guessing', async () => {
    upstream(500);
    const res = await health({ request: req('/api/admin/health'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { supabase: { readable: boolean; error: string; upstreamStatus: number; note: string }; unavailable: string[] };
    expect(body.supabase.readable).toBe(false);
    expect(body.supabase.error).toBe('db_unavailable');
    expect(body.supabase.upstreamStatus).toBe(500);
    expect(body.unavailable).toEqual(['supabase']);
  });
});

describe('push composer — a failed audience read never "sends to nobody" successfully', () => {
  it('a real send answers 502 and pushes nothing', async () => {
    upstream(200, [['vinax_push_subscriptions', fail(500)]], '[]');
    const res = await pushPost({ request: req('/api/admin/push', 'POST', { title: 'T', body: 'B', link: '/' }), env: ENV });
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('vinax_events'))).toBe(false);
  });

  it('a dry run with an unreadable audience is 502, not "0 devices"', async () => {
    upstream(200, [['vinax_push_subscriptions', fail(500)]], '[]');
    const res = await pushPost({ request: req('/api/admin/push', 'POST', { title: 'T', body: 'B', link: '/', dryRun: true }), env: ENV });
    expect(res.status).toBe(502);
  });

  it('an unreadable duplicate check refuses the send rather than risk a double blast', async () => {
    upstream(200, [['type=eq.announcement', fail(500)]], '[]');
    const res = await pushPost({ request: req('/api/admin/push', 'POST', { title: 'T', body: 'B', link: '/', dedupe_key: 'k1' }), env: ENV });
    expect(res.status).toBe(502);
  });
});
