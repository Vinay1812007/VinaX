/**
 * 14.0 — the database-backed admin API against a mocked PostgREST.
 *
 * Every GET answers { configured: false } without the database secrets; the
 * happy paths answer the exact keys docs/database.md promises the console; a
 * database failure is a 502 with its reason, never a silent zero; writes are
 * validated and audited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/api/status', () => ({
  COMPONENTS: [{ id: 'website', name: 'Website' }, { id: 'api', name: 'API' }],
  probeAll: async () => new Map([
    ['website', { ok: true, latency: 120, checkedAt: new Date().toISOString() }],
    ['api', { ok: true, latency: null, checkedAt: new Date().toISOString() }],
  ]),
}));

import * as overview from '../functions/api/admin/overview';
import * as live from '../functions/api/admin/live';
import * as listeners from '../functions/api/admin/listeners';
import * as analytics from '../functions/api/admin/analytics';
import * as feedback from '../functions/api/admin/feedback';
import * as content from '../functions/api/admin/content';
import * as settings from '../functions/api/admin/settings';
import * as experiments from '../functions/api/admin/experiments';
import * as push from '../functions/api/admin/push';
import * as notifications from '../functions/api/admin/notifications';
import * as auditRoute from '../functions/api/admin/audit';
import * as database from '../functions/api/admin/database';
import * as trends from '../functions/api/admin/trends';
import * as cronRun from '../functions/api/cron/run';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const TOKEN = 'owner-password-for-tests';
const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { ADMIN_LOGIN_PASSWORD: TOKEN, ...DB, VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:o@x' };
const NO_DB = { ADMIN_LOGIN_PASSWORD: TOKEN };

interface Call { url: URL; method: string; body: unknown; prefer: string }
type Responder = (call: Call) => Response | undefined;

let calls: Call[] = [];
function stub(respond: Responder = () => undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const parseBody = (): unknown => { try { return init?.body ? JSON.parse(String(init.body)) : null; } catch { return String(init?.body); } };
    const body = parseBody();
    const prefer = String((init?.headers as Record<string, string> | undefined)?.prefer ?? '');
    const call = { url, method, body, prefer };
    calls.push(call);
    if (!url.href.startsWith('https://db.test/rest/v1/')) return new Response('{}', { status: 200 });
    const r = respond(call);
    if (r) return r;
    return new Response(JSON.stringify(method === 'GET' ? [] : prefer.includes('representation') ? [] : null), { status: method === 'GET' ? 200 : 201, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }));
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const path = (c: Call) => c.url.pathname.replace('/rest/v1/', '');

function req(path: string, init: { method?: string; body?: unknown; token?: string | null; ip?: string } = {}): Request {
  const headers: Record<string, string> = { 'cf-connecting-ip': init.ip ?? '203.0.113.9' };
  if (init.token !== null) headers['x-admin-token'] = init.token ?? TOKEN;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://admin.vinaxmusic.online${path}`, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
type Handler = (ctx: { request: Request; env: Record<string, unknown>; waitUntil?: (p: Promise<unknown>) => void }) => Promise<Response>;
const run = async (h: Handler, path: string, init: Parameters<typeof req>[1] = {}, env: Record<string, unknown> = ENV) => {
  const res = await h({ request: req(path, init), env });
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

const GETS: Array<[string, Handler, string]> = [
  ['overview', overview.onRequestGet as Handler, '/api/admin/overview'],
  ['live', live.onRequestGet as Handler, '/api/admin/live'],
  ['listeners', listeners.onRequestGet as Handler, '/api/admin/listeners'],
  ['analytics', analytics.onRequestGet as Handler, '/api/admin/analytics?view=music'],
  ['feedback', feedback.onRequestGet as Handler, '/api/admin/feedback'],
  ['content', content.onRequestGet as Handler, '/api/admin/content'],
  ['settings', settings.onRequestGet as Handler, '/api/admin/settings'],
  ['experiments', experiments.onRequestGet as Handler, '/api/admin/experiments'],
  ['push', push.onRequestGet as Handler, '/api/admin/push'],
  ['notifications', notifications.onRequestGet as Handler, '/api/admin/notifications'],
  ['audit', auditRoute.onRequestGet as Handler, '/api/admin/audit'],
  ['database', database.onRequestGet as Handler, '/api/admin/database'],
  ['trends', trends.onRequestGet as Handler, '/api/admin/trends?view=trending'],
];

describe('every admin GET', () => {
  it.each(GETS)('%s refuses a missing or wrong token', async (_n, h, p) => {
    stub();
    expect((await run(h, p, { token: null })).res.status).toBe(401);
    expect((await run(h, p, { token: 'nope', ip: `198.51.100.${Math.floor(Math.random() * 200)}` })).res.status).toBe(401);
  });

  it.each(GETS)('%s answers { configured: false } without the database secrets', async (_n, h, p) => {
    stub();
    const { res, body } = await run(h, p, {}, NO_DB);
    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: false });
    expect(calls.filter((c) => c.url.host === 'db.test')).toEqual([]);
  });

  it.each(GETS.filter(([n]) => n !== 'database'))('%s answers 502 db_unavailable when the database fails', async (_n, h, p) => {
    stub(() => json({ message: 'boom' }, 503));
    const { res, body } = await run(h, p);
    expect(res.status).toBe(502);
    expect(body?.error).toBe('db_unavailable');
    expect(body?.configured).toBe(true);
  });

  it('database reports unreachable (502) when the meta read fails, and schema-missing when the table is absent', async () => {
    stub(() => json({ message: 'down' }, 503));
    const down = await run(database.onRequestGet as Handler, '/api/admin/database');
    expect(down.res.status).toBe(502);
    expect(down.body?.reachable).toBe(false);
    stub((c) => (path(c) === 'meta' ? json({ message: 'relation "meta" does not exist' }, 404) : undefined));
    const fresh = await run(database.onRequestGet as Handler, '/api/admin/database');
    expect(fresh.res.status).toBe(200);
    expect(fresh.body?.reachable).toBe(false);
    expect(fresh.body?.schema).toBeNull();
    expect((fresh.body?.missing as string[]).length).toBeGreaterThan(10);
  });
});

// overview, live and listeners (Users): see consolePeople.test.ts.

describe('analytics', () => {
  it('maps each view to its function and refuses an unknown view', async () => {
    stub((c) => (path(c).startsWith('rpc/') ? json(path(c) === 'rpc/stats_engagement' ? { byKind: [] } : path(c) === 'rpc/stats_platforms' ? { platforms: [], versions: [] } : [{ x: 1 }]) : undefined));
    for (const [view, fn] of [['music', 'stats_music'], ['geo', 'stats_geo'], ['retention', 'stats_retention'], ['funnel', 'stats_funnel'], ['skips', 'stats_skips'], ['errors', 'stats_errors']]) {
      calls = [];
      const { res, body } = await run(analytics.onRequestGet as Handler, `/api/admin/analytics?view=${view}&days=30`);
      expect(res.status, view).toBe(200);
      expect(body?.view).toBe(view);
      expect(body?.days).toBe(30);
      expect(calls.map(path)).toEqual([`rpc/${fn}`]);
    }
    calls = [];
    const eng = await run(analytics.onRequestGet as Handler, '/api/admin/analytics?view=engagement');
    expect(eng.body?.data).toEqual({ byKind: [], timeline: [{ x: 1 }], platforms: [], versions: [] });
    expect((await run(analytics.onRequestGet as Handler, '/api/admin/analytics?view=nope')).res.status).toBe(400);
  });
});

describe('feedback', () => {
  it('lists with counts and total, and changes a status with an audit row', async () => {
    stub((c) => {
      if (path(c) !== 'feedback') return undefined;
      if (c.method === 'GET' && c.prefer.includes('count=exact')) {
        const status = c.url.searchParams.get('status');
        return json([], 200, { 'content-range': `0-0/${status === 'eq.new' ? 2 : status === 'eq.read' ? 1 : status === 'eq.resolved' ? 9 : 2}` });
      }
      if (c.method === 'GET') return json([{ id: 7, at: 'now', listener_id: null, name: 'A', kind: 'bug', message: 'Broken', platform: 'web', app_version: null, country: 'IN', city: null, status: 'new', note: null, resolved_at: null }]);
      if (c.method === 'PATCH') return json([{ id: 7, status: 'resolved', note: 'fixed in 14.0', resolved_at: 'later' }]);
      return undefined;
    });
    const list = await run(feedback.onRequestGet as Handler, '/api/admin/feedback');
    expect(list.res.status).toBe(200);
    expect(list.body?.counts).toEqual({ new: 2, read: 1, resolved: 9, all: 12 });
    expect(list.body?.total).toBe(2);
    expect((list.body?.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 7, kind: 'bug', appVersion: null, resolvedAt: null });
    const upd = await run(feedback.onRequestPost as Handler, '/api/admin/feedback', { body: { action: 'status', id: 7, status: 'resolved', note: 'fixed in 14.0' } });
    expect(upd.res.status).toBe(200);
    const patch = calls.find((c) => c.method === 'PATCH' && path(c) === 'feedback');
    expect(patch?.url.searchParams.get('id')).toBe('eq.7');
    expect((patch?.body as { status: string; note: string; resolved_at: string }).status).toBe('resolved');
    expect((patch?.body as { resolved_at: string }).resolved_at).toBeTruthy();
    expect(calls.some((c) => path(c) === 'audit_log')).toBe(true);
    expect((await run(feedback.onRequestPost as Handler, '/api/admin/feedback', { body: { action: 'status', id: 7, status: 'weird' } })).res.status).toBe(400);
  });
});

describe('trends (Trending, Search Insights)', () => {
  const PIN = { id: 'abc123', title: 'Kesariya', artist: 'Arijit Singh', image: 'https://c.saavncdn.com/x.jpg' };
  const settingsRows = (pins: unknown, synonyms: unknown = { bday: 'birthday' }) => json([
    ...(pins ? [{ key: 'search-pins', value: pins, updated_at: 't', updated_by: 'owner' }] : []),
    { key: 'search-synonyms', value: synonyms, updated_at: 't', updated_by: 'owner' },
  ]);

  it('maps each view to its function with the days and refuses an unknown view', async () => {
    stub((c) => {
      if (path(c) === 'rpc/stats_trending') return json({ songs: [{ id: 's1', rank: 1, prev_rank: null, daily: [1, 2] }] });
      if (path(c) === 'rpc/stats_searches') return json({ totals: { searches: 3, zero: 1 } });
      if (path(c) === 'settings' && c.method === 'GET') return settingsRows({ ' Kesariya  ': PIN, x: PIN, bad: { title: 'no id' } });
      return undefined;
    });
    const tr = await run(trends.onRequestGet as Handler, '/api/admin/trends?view=trending&days=30');
    expect(tr.res.status).toBe(200);
    expect(tr.body).toEqual({ configured: true, days: 30, view: 'trending', data: { songs: [{ id: 's1', rank: 1, prev_rank: null, daily: [1, 2] }] } });
    expect(calls.find((c) => path(c) === 'rpc/stats_trending')?.body).toEqual({ p_days: 30, p_limit: 50 });

    calls = [];
    const se = await run(trends.onRequestGet as Handler, '/api/admin/trends?view=search&days=500');
    expect(se.res.status).toBe(200);
    expect(se.body?.days).toBe(7);
    expect(se.body?.data).toEqual({ totals: { searches: 3, zero: 1 } });
    expect(se.body?.pins).toEqual({ kesariya: PIN });
    expect(se.body?.synonyms).toEqual({ bday: 'birthday' });
    expect(calls.find((c) => path(c) === 'rpc/stats_searches')?.body).toEqual({ p_days: 7, p_limit: 50 });

    calls = [];
    const pins = await run(trends.onRequestGet as Handler, '/api/admin/trends?view=pins');
    expect(pins.body).toEqual({ configured: true, view: 'pins', pins: { kesariya: PIN }, synonyms: { bday: 'birthday' } });
    expect(calls.some((c) => path(c).startsWith('rpc/'))).toBe(false);

    expect((await run(trends.onRequestGet as Handler, '/api/admin/trends?view=nope')).res.status).toBe(400);
    expect((await run(trends.onRequestGet as Handler, '/api/admin/trends')).body?.error).toBe('unknown_view');
  });

  it('says the database needs its update when the function is missing (schema older than 11)', async () => {
    stub((c) => (path(c).startsWith('rpc/') ? json({ code: 'PGRST202', message: 'Could not find the function public.stats_searches' }, 404) : undefined));
    for (const view of ['trending', 'search']) {
      const { res, body } = await run(trends.onRequestGet as Handler, `/api/admin/trends?view=${view}`);
      expect(res.status, view).toBe(502);
      expect(body?.error, view).toBe('db_update_needed');
    }
  });

  it('pins a song for the normalised words, keeps the other pins and audits the change', async () => {
    stub((c) => {
      if (path(c) === 'settings' && c.method === 'GET') return settingsRows({ srivalli: { id: 'zz9', title: 'Srivalli' } });
      if (path(c) === 'settings' && c.method === 'POST') return json([{ key: 'search-pins', value: (c.body as { value: unknown }).value, updated_at: 't2', updated_by: 'x' }], 201);
      return undefined;
    });
    const { res, body } = await run(trends.onRequestPost as Handler, '/api/admin/trends', { body: { action: 'pin', query: '  KESARIYA   Remix ', song: { ...PIN, image: 'http://insecure.example/x.jpg', extra: 1 } } });
    expect(res.status).toBe(200);
    const want = { srivalli: { id: 'zz9', title: 'Srivalli' }, 'kesariya remix': { id: 'abc123', title: 'Kesariya', artist: 'Arijit Singh' } };
    expect(body).toEqual({ ok: true, key: 'search-pins', value: want });
    const upsert = calls.find((c) => path(c) === 'settings' && c.method === 'POST')?.body as { key: string; value: unknown };
    expect(upsert.key).toBe('search-pins');
    expect(upsert.value).toEqual(want);
    const audit = calls.find((c) => path(c) === 'audit_log')?.body as { action: string; target: string; summary: string };
    expect(audit).toMatchObject({ action: 'settings', target: 'search-pins' });
    expect(audit.summary).toContain('kesariya remix');
  });

  it('refuses a bad pin, more than 100 pins, and clears the setting when the last pin goes', async () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) many[`song ${i}`] = { id: `id${i}`, title: `Song ${i}` };
    stub((c) => (path(c) === 'settings' && c.method === 'GET' ? settingsRows(many) : undefined));
    const post = (b: unknown) => run(trends.onRequestPost as Handler, '/api/admin/trends', { body: b });
    expect((await post({ action: 'pin', query: 'x', song: PIN })).body?.error).toBe('bad_query');
    expect((await post({ action: 'pin', query: 'kesariya', song: { title: 'no id' } })).body?.error).toBe('bad_song');
    expect((await post({ action: 'pin', query: 'kesariya', song: { id: 'has spaces', title: 'T' } })).body?.error).toBe('bad_song');
    expect((await post({ action: 'pin', query: 'kesariya', song: PIN })).body?.error).toBe('too_many');
    expect((await post({ action: 'pin', query: 'song 5', song: PIN })).res.status).toBe(200);
    expect((await post({ action: 'drop' })).body?.error).toBe('unknown_action');

    stub((c) => (path(c) === 'settings' && c.method === 'GET' ? settingsRows({ kesariya: PIN }) : undefined));
    const gone = await post({ action: 'unpin', query: 'Kesariya' });
    expect(gone.body).toEqual({ ok: true, key: 'search-pins', value: {} });
    expect(calls.find((c) => path(c) === 'settings' && c.method === 'DELETE')?.url.searchParams.get('key')).toBe('eq.search-pins');
    calls = [];
    const none = await post({ action: 'unpin', query: 'never pinned' });
    expect(none.body?.unchanged).toBe(true);
    expect(calls.some((c) => path(c) === 'settings' && c.method !== 'GET')).toBe(false);
  });

  it('adds a synonym to the stored ones and refuses the same word twice', async () => {
    stub((c) => (path(c) === 'settings' && c.method === 'GET' ? settingsRows(null, { bday: 'birthday' }) : undefined));
    const post = (b: unknown) => run(trends.onRequestPost as Handler, '/api/admin/trends', { body: b });
    const ok = await post({ action: 'synonym', typed: ' ARR ', meant: 'A. R. Rahman' });
    expect(ok.body).toEqual({ ok: true, key: 'search-synonyms', value: { bday: 'birthday', arr: 'A. R. Rahman' } });
    expect((calls.find((c) => path(c) === 'settings' && c.method === 'POST')?.body as { value: unknown }).value).toEqual({ bday: 'birthday', arr: 'A. R. Rahman' });
    expect((await post({ action: 'synonym', typed: 'Same', meant: 'same' })).body?.error).toBe('bad_synonym');
    expect((await post({ action: 'synonym', typed: 'x', meant: '' })).body?.error).toBe('bad_synonym');
  });
});

describe('settings', () => {
  it('lists every known key with the published values and rejects unknown keys on write', async () => {
    stub((c) => (path(c) === 'settings' && c.method === 'GET' ? json([{ key: 'greeting', value: { text: 'Hi' }, updated_at: 't', updated_by: 'owner' }]) : undefined));
    const { res, body } = await run(settings.onRequestGet as Handler, '/api/admin/settings');
    expect(res.status).toBe(200);
    expect((body?.keys as Array<{ key: string }>).map((k) => k.key)).toContain('banners');
    expect(body?.values).toEqual({ greeting: { text: 'Hi' } });
    expect(body?.updated).toEqual({ greeting: { at: 't', by: 'owner' } });
    expect((await run(settings.onRequestPost as Handler, '/api/admin/settings', { body: { key: 'not-a-key', value: 1 } })).res.status).toBe(400);
    expect((await run(settings.onRequestGet as Handler, '/api/admin/settings?key=not-a-key')).res.status).toBe(400);
  });

  it('publishes a value through an upsert, records history and audits before/after', async () => {
    stub((c) => {
      if (path(c) === 'settings' && c.method === 'GET') return json([{ key: 'greeting', value: { text: 'Old' }, updated_at: 't', updated_by: 'owner' }]);
      if (path(c) === 'settings' && c.method === 'POST') return json([{ key: 'greeting', value: { text: 'New' }, updated_at: 't2', updated_by: 'owner' }], 201);
      return undefined;
    });
    const { res, body } = await run(settings.onRequestPost as Handler, '/api/admin/settings', { body: { key: 'greeting', value: { text: 'New' } } });
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, key: 'greeting', value: { text: 'New' }, updatedAt: 't2' });
    const upsert = calls.find((c) => path(c) === 'settings' && c.method === 'POST');
    expect(upsert?.prefer).toContain('merge-duplicates');
    expect(upsert?.url.searchParams.get('on_conflict')).toBe('key');
    expect(calls.some((c) => path(c) === 'settings_history' && c.method === 'POST')).toBe(true);
    const audit = calls.find((c) => path(c) === 'audit_log')?.body as { before: unknown; after: unknown; action: string };
    expect(audit.action).toBe('settings');
    expect(audit.before).toEqual({ text: 'Old' });
    expect(audit.after).toEqual({ text: 'New' });
  });

  it('clears a key with a delete and a null history row', async () => {
    stub((c) => (path(c) === 'settings' && c.method === 'DELETE' ? json([{ key: 'greeting', value: { text: 'Old' } }]) : undefined));
    const { res, body } = await run(settings.onRequestPost as Handler, '/api/admin/settings', { body: { key: 'greeting', value: null } });
    expect(res.status).toBe(200);
    expect(body?.value).toBeNull();
    expect(calls.find((c) => path(c) === 'settings' && c.method === 'DELETE')?.url.searchParams.get('key')).toBe('eq.greeting');
    expect((calls.find((c) => path(c) === 'settings_history')?.body as { value: unknown }).value).toBeNull();
  });
});

describe('content and experiments', () => {
  it('blocks a keyword lower-cased, treats a duplicate as already blocked, refuses short keywords', async () => {
    stub((c) => (path(c) === 'blocked_content' && c.method === 'POST' ? json([{ id: 3, kind: 'keyword', value: 'remix', label: null, reason: null, created_at: 't' }], 201) : undefined));
    const ok = await run(content.onRequestPost as Handler, '/api/admin/content', { body: { action: 'block', kind: 'keyword', value: '  ReMix ' } });
    expect(ok.res.status).toBe(200);
    expect((ok.body?.row as { value: string }).value).toBe('remix');
    expect((await run(content.onRequestPost as Handler, '/api/admin/content', { body: { action: 'block', kind: 'keyword', value: 'ab' } })).res.status).toBe(400);
    expect((await run(content.onRequestPost as Handler, '/api/admin/content', { body: { action: 'block', kind: 'movie', value: 'x' } })).res.status).toBe(400);
    stub((c) => (path(c) === 'blocked_content' && c.method === 'POST' ? json({ code: '23505', message: 'duplicate key' }, 409) : undefined));
    const dup = await run(content.onRequestPost as Handler, '/api/admin/content', { body: { action: 'block', kind: 'song', value: 'abc123', label: 'Song' } });
    expect(dup.res.status).toBe(200);
    expect(dup.body?.already).toBe(true);
  });

  it('saves an experiment with sanitised variants and refuses a bad key', async () => {
    stub((c) => (path(c) === 'experiments' && c.method === 'POST' ? json([{ key: 'home-v2', name: 'Home v2', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }], active: true, created_at: 't', updated_at: 't' }], 201) : undefined));
    const { res, body } = await run(experiments.onRequestPost as Handler, '/api/admin/experiments', { body: { action: 'save', key: 'Home-V2', name: 'Home v2', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }, { name: 'c', pct: 40 }], active: true } });
    expect(res.status).toBe(200);
    const sent = calls.find((c) => path(c) === 'experiments' && c.method === 'POST')?.body as { key: string; variants: unknown[] };
    expect(sent.key).toBe('home-v2');
    expect(sent.variants).toEqual([{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }]);
    expect((body?.row as { key: string }).key).toBe('home-v2');
    expect((await run(experiments.onRequestPost as Handler, '/api/admin/experiments', { body: { action: 'save', key: 'Bad Key!', variants: [{ name: 'a', pct: 10 }] } })).res.status).toBe(400);
    expect((await run(experiments.onRequestPost as Handler, '/api/admin/experiments', { body: { action: 'save', key: 'ok', variants: [] } })).res.status).toBe(400);
  });
});

// The push sender and notification history: see consoleEngage.test.ts (console rebuild).

describe('database and jobs', () => {
  it('reports the schema, tables, counts and jobs with overdue flags', async () => {
    const old = new Date(Date.now() - 5 * 3_600_000).toISOString();
    stub((c) => {
      const p = path(c);
      if (p === 'meta') return json([{ value: { version: 1, appliedAt: 'x' } }]);
      if (p === 'rpc/table_stats') return json([{ name: 'events', rows: 1200, bytes: 4096 }, { name: 'listeners', rows: 40, bytes: 2048 }]);
      if (p === 'rpc/table_counts') return json({ listeners: 40, events: 1200 });
      if (p === 'job_runs') return json([{ job: 'status-tick', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), ok: true, summary: { website: 'up' } }, { job: 'housekeeping', started_at: old, finished_at: old, ok: false, summary: { error: 'x' } }]);
      if (p === 'settings') return json([{ key: 'retention', value: { eventsDays: 90 }, updated_at: 't', updated_by: 'owner' }]);
      return undefined;
    });
    const { res, body } = await run(database.onRequestGet as Handler, '/api/admin/database');
    expect(res.status).toBe(200);
    expect(body?.reachable).toBe(true);
    expect(body?.schema).toEqual({ version: 1, appliedAt: 'x' });
    expect(body?.tables).toHaveLength(2);
    expect(body?.counts).toEqual({ listeners: 40, events: 1200 });
    expect(body?.retention).toEqual({ eventsDays: 90, errorsDays: null, feedbackDays: null, notificationsDays: null });
    expect((body?.tables as Array<{ name: string; label: string; keptFor: string; approximate: boolean }>).find((t) => t.name === 'events')).toMatchObject({ label: 'Play history and activity', keptFor: '90 days', approximate: true });
    expect((body?.missing as string[])).toContain('accounts');
    const jobs = body?.jobs as Array<{ job: string; overdue: boolean; ok: boolean | null; neverRan: boolean }>;
    expect(jobs.find((j) => j.job === 'status-tick')).toMatchObject({ overdue: false, ok: true, neverRan: false });
    expect(jobs.find((j) => j.job === 'housekeeping')).toMatchObject({ overdue: true, ok: false });
  });

  it('runs a job by hand, recording the run, and refuses bad maintenance arguments', async () => {
    stub((c) => {
      const p = path(c);
      if (p === 'job_runs' && c.method === 'POST') return json([{ id: 5 }], 201);
      if (p === 'rpc/uptime_tick') return json(null);
      if (p === 'rpc/purge_events') return json(42);
      return undefined;
    });
    const job = await run(database.onRequestPost as Handler, '/api/admin/database', { body: { action: 'run_job', job: 'status-tick' } });
    expect(job.res.status).toBe(200);
    expect((job.body?.result as { ok: boolean; summary: Record<string, string> }).ok).toBe(true);
    expect((job.body?.result as { summary: Record<string, string> }).summary).toEqual({ website: 'up', api: 'up' });
    expect(calls.filter((c) => path(c) === 'rpc/uptime_tick')).toHaveLength(2);
    expect(calls.find((c) => path(c) === 'job_runs' && c.method === 'PATCH')?.url.searchParams.get('id')).toBe('eq.5');
    const purge = await run(database.onRequestPost as Handler, '/api/admin/database', { body: { action: 'purge_events', days: 30 } });
    expect(purge.body).toEqual({ ok: true, deleted: 42, days: 30 });
    expect((await run(database.onRequestPost as Handler, '/api/admin/database', { body: { action: 'purge_events', days: 2 } })).res.status).toBe(400);
    expect((await run(database.onRequestPost as Handler, '/api/admin/database', { body: { action: 'run_job', job: 'nope' } })).res.status).toBe(400);
  });

  it('POSTs answer 503 db_not_configured without the database', async () => {
    stub();
    const { res, body } = await run(database.onRequestPost as Handler, '/api/admin/database', { body: { action: 'sweep_rooms' } }, NO_DB);
    expect(res.status).toBe(503);
    expect(body?.error).toBe('db_not_configured');
  });
});

describe('POST /api/cron/run', () => {
  it('accepts the cron secret or the owner token, refuses everything else, and names unknown jobs', async () => {
    stub((c) => (path(c) === 'job_runs' && c.method === 'POST' ? json([{ id: 1 }], 201) : path(c) === 'rpc/uptime_tick' ? json(null) : undefined));
    const env = { ...ENV, CRON_SECRET: 'cron-secret' };
    const mk = (headers: Record<string, string>, body: unknown) => new Request('https://www.vinaxmusic.online/api/cron/run', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.50', ...headers }, body: JSON.stringify(body) });
    expect((await cronRun.onRequestPost({ request: mk({}, { job: 'status-tick' }), env })).status).toBe(401);
    expect((await cronRun.onRequestPost({ request: mk({ 'x-cron-secret': 'wrong' }, { job: 'status-tick' }), env })).status).toBe(401);
    expect((await cronRun.onRequestPost({ request: mk({ 'x-cron-secret': 'cron-secret' }, { job: 'laundry' }), env })).status).toBe(400);
    const ok = await cronRun.onRequestPost({ request: mk({ 'x-cron-secret': 'cron-secret' }, { job: 'status-tick' }), env });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { job: string; ok: boolean }).job).toBe('status-tick');
    expect((await cronRun.onRequestPost({ request: mk({ 'x-admin-token': TOKEN }, { job: 'status-tick' }), env })).status).toBe(200);
    expect((await cronRun.onRequestPost({ request: mk({ 'x-cron-secret': 'cron-secret' }, { job: 'status-tick' }), env: { ...env, SUPABASE_URL: undefined } })).status).toBe(503);
  });
});
