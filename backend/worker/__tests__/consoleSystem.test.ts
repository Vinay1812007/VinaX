/**
 * Console rebuild — the System pages' server side: App Errors (grouped, with the
 * owner's status; clearing is owner-only), the Change log filters, scheduled
 * jobs (on/off and how often from the `jobs` setting, per-kind retention),
 * the bots list behind robots.txt, and the API keys list (names only).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/api/status', () => ({
  COMPONENTS: [{ id: 'website' }],
  probeAll: async () => new Map([['website', { ok: true, latency: 10 }]]),
}));
vi.mock('../functions/_lib/scheduledPush', () => ({ runScheduledNotifications: vi.fn(async () => ({ sent: 2 })) }));

import * as errors from '../functions/api/admin/errors';
import * as auditRoute from '../functions/api/admin/audit';
import * as database from '../functions/api/admin/database';
import * as seo from '../functions/api/admin/seo';
import * as robotsRoute from '../functions/api/robots';
import { ENV_ITEMS, onRequestGet as envGet } from '../functions/api/admin/envcheck';
import { isDue, jobSettings, retentionOf, runScheduled } from '../functions/_lib/jobs';
import { botChoices, BOTS, readRobotsBlocked, robotsTxt } from '../functions/_lib/robots';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'auth-secret', ...DB };

interface Call { url: URL; method: string; body: unknown }
let calls: Call[] = [];
type Responder = (c: Call, table: string) => Response | undefined;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
function stub(respond: Responder = () => undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const c = { url, method, body };
    calls.push(c);
    const table = url.pathname.replace('/rest/v1/', '');
    const r = respond(c, table);
    if (r) return r;
    if (table === 'admins') return json([{ email: 'editor@example.com', role: 'editor', name: null, picture: null }]);
    if (table === 'audit_log' && method === 'POST') return json([], 201);
    return json([]);
  }));
}
const req = (path: string, token: string | null = 'owner-pass', body?: unknown) => new Request(`https://admin.vinaxmusic.online${path}`, {
  method: body !== undefined ? 'POST' : 'GET',
  headers: { 'cf-connecting-ip': '203.0.113.30', ...(token ? { 'x-admin-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const call = async (h: unknown, r: Request, env: Record<string, unknown> = ENV) => {
  const res = await (h as H)({ request: r, env });
  const text = await res.text();
  let body: Record<string, unknown> | null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text, res };
};

beforeEach(() => { resetSettingsMemo(); resetAdminMemo(); _resetRateLimitsForTests(); stub(); });
afterEach(() => vi.unstubAllGlobals());

describe('App Errors', () => {
  it('GET answers the grouped errors with status and people affected', async () => {
    stub((_c, t) => (t === 'rpc/stats_errors' ? json({ total: 30, groups: 2, users: 4, byDay: [{ day: '2026-11-01', hits: 30 }], top: [{ fingerprint: 'a'.repeat(32), errorKind: 'download', message: 'Download of "X" timed out', variants: 14, hits: 20, users: 3, status: 'investigating' }] }) : undefined));
    const r = await call(errors.onRequestGet, req('/api/admin/errors?days=30'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, days: 30, total: 30, groups: 2, users: 4 });
    expect((r.body?.top as Array<{ status: string }>)[0].status).toBe('investigating');
    expect(calls.find((c) => c.url.pathname.endsWith('/rpc/stats_errors'))?.body).toEqual({ p_days: 30, p_limit: 300 });
  });

  it('a status change upserts error_status with who did it; bad input is refused', async () => {
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    const ok = await call(errors.onRequestPost, req('/api/admin/errors', editor, { action: 'status', fingerprint: 'b'.repeat(32), status: 'fixed', note: 'shipped 1.9' }));
    expect(ok.status).toBe(200);
    const up = calls.find((c) => c.url.pathname.endsWith('/error_status') && c.method === 'POST');
    expect(up?.body).toMatchObject({ fingerprint: 'b'.repeat(32), status: 'fixed', note: 'shipped 1.9', updated_by: 'editor@example.com' });
    expect((await call(errors.onRequestPost, req('/api/admin/errors', editor, { action: 'status', fingerprint: 'x', status: 'fixed' }))).status).toBe(400);
    expect((await call(errors.onRequestPost, req('/api/admin/errors', editor, { action: 'status', fingerprint: 'b'.repeat(32), status: 'gone' }))).status).toBe(400);
  });

  it('clearing every error is owner-only', async () => {
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    expect((await call(errors.onRequestPost, req('/api/admin/errors', editor, { action: 'clear' }))).status).toBe(403);
    stub((c, t) => (t === 'events' && c.method === 'DELETE' ? json([{ id: 1 }, { id: 2 }]) : undefined));
    const r = await call(errors.onRequestPost, req('/api/admin/errors', 'owner-pass', { action: 'clear' }));
    expect(r.body).toEqual({ ok: true, deleted: 2 });
    expect(calls.find((c) => c.method === 'DELETE')?.url.searchParams.get('kind')).toBe('eq.error');
  });

  it('says the database needs updating when the new function is missing', async () => {
    stub((_c, t) => (t === 'rpc/stats_errors' ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : undefined));
    const r = await call(errors.onRequestGet, req('/api/admin/errors'));
    expect(r.status).toBe(502);
    expect(r.body?.error).toBe('db_update_needed');
  });
});

describe('Change log', () => {
  it('filters by admin, action and days in India, pages, and lists the dropdown choices', async () => {
    stub((c, t) => {
      if (t !== 'audit_log') return undefined;
      if (c.url.searchParams.get('select') === 'actor,action') return json([{ actor: 'b@x.io', action: 'settings' }, { actor: 'a@x.io', action: 'push-send' }, { actor: 'b@x.io', action: 'settings' }]);
      if (c.method === 'HEAD' || c.url.searchParams.get('select') === 'count' || c.url.searchParams.has('limit') === false) return new Response(null, { status: 200, headers: { 'content-range': '0-0/7' } });
      return new Response(JSON.stringify([{ id: 1, at: 't', actor: 'b@x.io', action: 'settings', summary: 's', request_id: 'r' }]), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/7' } });
    });
    const r = await call(auditRoute.onRequestGet, req('/api/admin/audit?actor=b@x.io&action=settings&from=2026-11-01&to=2026-11-02&limit=25&offset=25'));
    expect(r.status).toBe(200);
    expect(r.body?.actors).toEqual(['a@x.io', 'b@x.io']);
    expect(r.body?.actions).toEqual(['push-send', 'settings']);
    expect((r.body?.rows as Array<{ requestId: string }>)[0].requestId).toBe('r');
    const main = calls.find((c) => c.url.searchParams.get('select') === '*')!;
    expect(main.url.searchParams.get('actor')).toBe('eq.b@x.io');
    expect(main.url.searchParams.get('action')).toBe('eq.settings');
    expect(main.url.searchParams.getAll('at')).toEqual(['gte.2026-10-31T18:30:00.000Z', 'lt.2026-11-02T18:30:00.000Z']);
    expect(main.url.searchParams.get('offset')).toBe('25');
  });
});

describe('scheduled jobs', () => {
  it('reads the jobs setting with defaults and only allowed choices', () => {
    const cfg = jobSettings({ housekeeping: { enabled: false, every: 360 }, 'status-tick': { every: 7 } });
    expect(cfg.housekeeping).toEqual({ enabled: false, every: 360 });
    expect(cfg['status-tick']).toEqual({ enabled: true, every: 30 });
    expect(cfg['scheduled-notifications']).toEqual({ enabled: true, every: 5 });
  });

  it('a job is due when on and its last run is old enough', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(isDue({ enabled: true, every: 60 }, null, now)).toBe(true);
    expect(isDue({ enabled: true, every: 60 }, '2026-11-02T09:30:00Z', now)).toBe(false);
    expect(isDue({ enabled: true, every: 60 }, '2026-11-02T09:01:00Z', now)).toBe(true); // 2-minute grace
    expect(isDue({ enabled: false, every: 30 }, null, now)).toBe(false);
  });

  it('per-kind retention: usage defaults to 180 days, the rest forever unless set', () => {
    expect(retentionOf(null)).toEqual({ eventsDays: 180, errorsDays: null, feedbackDays: null, notificationsDays: null });
    expect(retentionOf({ eventsDays: 90, errorsDays: 30, feedbackDays: 0, notificationsDays: 2 })).toEqual({ eventsDays: 90, errorsDays: 30, feedbackDays: null, notificationsDays: 7 });
  });

  it('the cron skips switched-off jobs and runs the due ones', async () => {
    stub((c, t) => {
      if (t === 'settings') return json([{ key: 'jobs', value: { 'personal-embed': { enabled: false }, housekeeping: { enabled: false } }, updated_at: 't', updated_by: 'o' }]);
      if (t === 'job_runs' && c.method === 'GET') return json([{ job: 'status-tick', started_at: new Date(Date.now() - 5 * 60_000).toISOString() }]);
      if (t === 'job_runs' && c.method === 'POST') return json([{ id: 9 }], 201);
      return undefined;
    });
    const out = await runScheduled(ENV, Date.now());
    expect(out.map((r) => r.job)).toEqual(['scheduled-notifications']);
    expect(out[0].summary).toEqual({ sent: 2 });
  });

  it('housekeeping purges usage and each kind with its own period', async () => {
    stub((c, t) => {
      if (t === 'settings') return json([{ key: 'retention', value: { eventsDays: 90, errorsDays: 30, feedbackDays: 365 }, updated_at: 't', updated_by: 'o' }]);
      if (t === 'job_runs' && c.method === 'POST') return json([{ id: 3 }], 201);
      if (t.startsWith('rpc/')) return json(t === 'rpc/room_sweep' ? { rooms: 0, members: 0 } : 0);
      return undefined;
    });
    const r = await call(database.onRequestPost, req('/api/admin/database', 'owner-pass', { action: 'run_job', job: 'housekeeping' }));
    expect((r.body?.result as { ok: boolean }).ok).toBe(true);
    const purges = calls.filter((c) => c.url.pathname.endsWith('/rpc/purge_kind')).map((c) => c.body);
    expect(purges).toEqual(expect.arrayContaining([{ p_kind: 'plays', p_keep_days: 90 }, { p_kind: 'errors', p_keep_days: 30 }, { p_kind: 'feedback', p_keep_days: 365 }]));
    expect(calls.some((c) => c.url.pathname.endsWith('/rpc/purge_events'))).toBe(false);
  });

  it('the owner switches a job off or changes how often; bad choices are refused', async () => {
    const r = await call(database.onRequestPost, req('/api/admin/database', 'owner-pass', { action: 'job_setting', job: 'housekeeping', enabled: false, every: 360 }));
    expect(r.body).toMatchObject({ ok: true, job: 'housekeeping', enabled: false, every: 360 });
    const write = calls.find((c) => c.url.pathname.endsWith('/settings') && c.method === 'POST');
    expect(write?.body).toMatchObject({ key: 'jobs', value: { housekeeping: { enabled: false, every: 360 } } });
    expect((await call(database.onRequestPost, req('/api/admin/database', 'owner-pass', { action: 'job_setting', job: 'housekeeping', every: 7 }))).body?.error).toBe('bad_every');
    expect((await call(database.onRequestPost, req('/api/admin/database', 'owner-pass', { action: 'job_setting', job: 'laundry' }))).status).toBe(400);
  });
});

describe('bots and robots.txt', () => {
  const STATIC = readFileSync(fileURLToPath(new URL('../../../frontend/public/robots.txt', import.meta.url)), 'utf8');

  it('with no choices, blocks exactly the bots the committed robots.txt blocks', () => {
    const built = readRobotsBlocked(robotsTxt(null)).sort();
    expect(built).toEqual(readRobotsBlocked(STATIC).sort());
    expect(robotsTxt(null)).toContain('Sitemap: https://www.vinaxmusic.online/sitemap.xml');
    expect(robotsTxt(null)).toMatch(/^User-agent: \*$/m);
  });

  it("follows the owner's Allow / Block choices", () => {
    const txt = robotsTxt({ bots: { GPTBot: true, Bingbot: false } });
    const blocked = readRobotsBlocked(txt);
    expect(blocked).not.toContain('GPTBot');
    expect(blocked).toContain('Bingbot');
    expect(botChoices({ bots: { GPTBot: 'yes' } }).GPTBot).toBe(false); // only booleans count
    expect(BOTS.every((b) => ['search', 'ai', 'seo'].includes(b.group))).toBe(true);
  });

  it('GET /api/robots answers plain text from the setting', async () => {
    stub((_c, t) => (t === 'settings' ? json([{ key: 'robots', value: { bots: { AhrefsBot: true } }, updated_at: 't', updated_by: 'o' }]) : undefined));
    const r = await call(robotsRoute.onRequestGet, req('/api/robots', null), DB);
    expect(r.res.headers.get('content-type')).toContain('text/plain');
    expect(readRobotsBlocked(r.text)).not.toContain('AhrefsBot');
    const none = await call(robotsRoute.onRequestGet, req('/api/robots', null), {});
    expect(readRobotsBlocked(none.text)).toContain('AhrefsBot');
  });

  it('the bots view lists every bot with its saved and live state', async () => {
    stub((c, t) => {
      if (t === 'settings') return json([{ key: 'robots', value: { bots: { GPTBot: true } }, updated_at: 't', updated_by: 'o' }]);
      if (c.url.pathname === '/robots.txt') return new Response(STATIC, { status: 200 });
      return undefined;
    });
    const r = await call(seo.onRequestGet, req('/api/admin/seo?view=bots'));
    const bots = r.body?.bots as Array<{ id: string; allowed: boolean; live: boolean | null }>;
    expect(bots.find((b) => b.id === 'GPTBot')).toMatchObject({ allowed: true, live: false });
    expect(bots.find((b) => b.id === 'Googlebot')).toMatchObject({ allowed: true, live: true });
    expect(r.body?.publishReady).toBe(false);
  });

  it('publishing calls the website rebuild link (editors and owners only)', async () => {
    const viewerEnv = { ...ENV, PAGES_DEPLOY_HOOK: 'https://api.cloudflare.com/hook/abc' };
    expect((await call(seo.onRequestPost, req('/api/admin/seo', 'owner-pass', { action: 'publish_robots' }), ENV)).body?.error).toBe('publish_not_configured');
    stub((c) => (c.url.host === 'api.cloudflare.com' ? json({ success: true }) : undefined));
    const r = await call(seo.onRequestPost, req('/api/admin/seo', 'owner-pass', { action: 'publish_robots' }), viewerEnv);
    expect(r.body).toEqual({ ok: true });
    expect(calls.some((c) => c.url.host === 'api.cloudflare.com' && c.method === 'POST')).toBe(true);
    expect((await call(seo.onRequestPost, req('/api/admin/seo', null, { action: 'publish_robots' }), viewerEnv)).status).toBe(401);
  });
});

describe('API keys status', () => {
  it('plain names, Set / Missing only, never a value', async () => {
    const r = await call(envGet, req('/api/admin/envcheck'), { ...ENV, GEMINI_API_KEY: 'AIza-secret-value' });
    const items = r.body?.items as Array<{ name: string; label: string; set: boolean }>;
    expect(items.find((i) => i.name === 'GEMINI_API_KEY')).toMatchObject({ label: 'AI provider: Google Gemini', set: true });
    expect(r.text).not.toContain('AIza-secret-value');
    expect(ENV_ITEMS.find((i) => i.name === 'ADMIN_LOGIN_PASSWORD')?.required).toBe(false);
    expect(items.every((i) => typeof i.label === 'string' && i.label.length > 2)).toBe(true);
  });
});
