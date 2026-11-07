/**
 * Console rebuild — the console's Dashboard, Live Now and Users routes, and the
 * sign-in checks behind "Block user" and "Sign out this device".
 *
 * Pinned here: people numbers come from the signed-in-only SQL; anonymous
 * devices and their ids never reach the browser; the Users route maps its
 * query to admin_users; viewers cannot change anything and only an owner can
 * delete a person's data; a blocked person cannot sign in or keep a session;
 * a device the owner signed out loses its session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as overview from '../functions/api/admin/overview';
import * as live from '../functions/api/admin/live';
import * as listeners from '../functions/api/admin/listeners';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { issueSession, resetGoogleKeys } from '../functions/_lib/googleAuth';
import { signId } from '../functions/_lib/identity';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const TOKEN = 'owner-password-for-tests';
const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { ADMIN_LOGIN_PASSWORD: TOKEN, AUTH_SECRET: 'auth-secret-for-tests', ...DB };

interface Call { url: URL; method: string; body: unknown; prefer: string }
type Responder = (call: Call) => Response | undefined;
let calls: Call[] = [];
function stub(respond: Responder = () => undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const parse = (): unknown => { try { return init?.body ? JSON.parse(String(init.body)) : null; } catch { return String(init?.body); } };
    const body = parse();
    const prefer = String((init?.headers as Record<string, string> | undefined)?.prefer ?? '');
    const call = { url, method, body, prefer };
    calls.push(call);
    const r = respond(call);
    if (r) return r;
    return new Response(JSON.stringify(method === 'GET' ? [] : prefer.includes('representation') ? [] : null), { status: method === 'GET' ? 200 : 201, headers: { 'content-type': 'application/json' } });
  }));
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const path = (c: Call) => c.url.pathname.replace('/rest/v1/', '');
type Handler = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
async function run(h: Handler, p: string, init: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9', 'x-admin-token': init.token ?? TOKEN };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await h({ request: new Request(`https://admin.vinaxmusic.online${p}`, { method: init.body !== undefined ? 'POST' : 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }), env: ENV });
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeEach(() => { resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

const ACCT = '110000000000000000001';
const DEVICE = 'd_' + 'ab'.repeat(16);
const ANON = 'd_' + 'cd'.repeat(16);

describe('Dashboard (overview)', () => {
  it('passes the date range to the timeline and answers plain attention items', async () => {
    const kpis = { activeNow: 2, users: 15, listeners: 15, accounts: 15, errors24h: 35, errorsPrev24h: 4, feedbackNew: 1, pushDevices: 0, roomsActive: 1 };
    stub((c) => {
      const p = path(c);
      if (p === 'rpc/stats_overview') return json(kpis);
      if (p === 'rpc/stats_timeline') { expect(c.body).toEqual({ p_days: 30 }); return json([{ day: '2026-11-01', plays: 4 }]); }
      if (p === 'rpc/stats_platforms') return json({ platforms: [{ platform: 'android', users: 9 }], versions: [] });
      if (p === 'meta') return json([{ key: 'schema', value: { version: 15, appliedAt: 'x' } }]);
      return undefined;
    });
    const { res, body } = await run(overview.onRequestGet as Handler, '/api/admin/overview?days=30');
    expect(res.status).toBe(200);
    expect(body?.days).toBe(30);
    expect(body?.kpis).toEqual(kpis);
    const att = body?.attention as Array<{ id: string; level: string; text: string; page: string; tab?: string }>;
    expect(att.map((a) => `${a.level}:${a.page}/${a.tab}`)).toEqual(['bad:health/errors', 'warn:feedback/new', 'warn:notifications/setup', 'info:live/rooms']);
    expect(att[0].text).toBe('35 app errors in the last 24 hours — more than double the day before.');
    expect(att.every((a) => !/listener|device only|fcm/i.test(a.text))).toBe(true);
  });

  it('clamps the range and asks for the database update when the schema is behind', () => {
    expect(overview.attentionFor({}, { version: 7 })[0]).toMatchObject({ id: 'schema-old', page: 'database', tab: 'maintenance' });
    expect(overview.attentionFor({}, null)[0]).toMatchObject({ id: 'schema-missing', level: 'bad' });
  });
});

describe('Users (listeners)', () => {
  it('maps every filter to admin_users and answers account rows without device ids', async () => {
    stub((c) => {
      if (path(c) !== 'rpc/admin_users') return undefined;
      expect(c.body).toEqual({
        p_q: 'asha', p_platform: 'android', p_active_days: 7, p_joined_days: null, p_joined_from: '2026-10-01T18:30:00.000Z', p_joined_to: '2026-10-31T18:30:00.000Z',
        p_country: 'IN', p_region: 'Telangana', p_city: 'Hyderabad', p_version: '1.8.3', p_language: 'telugu', p_ids: null, p_sort: 'plays', p_limit: 25, p_offset: 50,
      });
      return json({ total: 1, rows: [{ id: ACCT, name: 'Asha', email: 'a@x.in', picture: null, platform: 'android', app_version: '1.8.3', country: 'IN', region: 'Telangana', city: 'Hyderabad', now_playing: null, is_playing: false, joined: 'j', last_seen: 'l', devices: 2, plays: 40, language: 'telugu', blocked_at: null }], counts: { users: 15 } });
    });
    const q = '?q=asha&platform=android&active=7&joinedFrom=2026-10-02&joinedTo=2026-10-31&country=in&region=Telangana&city=Hyderabad&version=1.8.3&language=Telugu&sort=plays&limit=25&offset=50';
    const { res, body } = await run(listeners.onRequestGet as Handler, '/api/admin/listeners' + q);
    expect(res.status).toBe(200);
    expect(body?.total).toBe(1);
    expect(body?.rows).toEqual([{ id: ACCT, name: 'Asha', email: 'a@x.in', picture: null, platform: 'android', appVersion: '1.8.3', country: 'IN', region: 'Telangana', city: 'Hyderabad', nowPlaying: null, isPlaying: false, joined: 'j', lastSeen: 'l', devices: 2, plays: 40, language: 'telugu', blocked: false, os: null, browser: null, device: null, listen30d: 0, listenToday: 0, tags: [] }]);
    expect(JSON.stringify(body)).not.toMatch(/d_[a-f0-9]{8}/);
  });

  it('passes a device filter, the listening sort and the listening time (schema 13)', async () => {
    stub((c) => (path(c) === 'rpc/admin_users'
      ? json({ total: 1, rows: [{ id: ACCT, platform: 'web', os: 'macos', browser: 'Chrome', device: 'macos-web', listen30d: '7260', listen_today: 900 }], counts: { byDevice: { 'macos-web': 1 } } })
      : undefined));
    const { body } = await run(listeners.onRequestGet as Handler, '/api/admin/listeners?platform=macos-web&sort=listening');
    const b = calls.find((c) => path(c) === 'rpc/admin_users')?.body as Record<string, unknown>;
    expect(b).toMatchObject({ p_platform: 'macos-web', p_sort: 'listening' });
    expect((body?.rows as Array<Record<string, unknown>>)[0]).toMatchObject({ os: 'macos', browser: 'Chrome', device: 'macos-web', listen30d: 7260, listenToday: 900 });
    expect(body?.counts).toEqual({ byDevice: { 'macos-web': 1 } });
  });

  it('ignores junk filters, keeps ?q=&limit= for the user picker, and refuses a bad account id', async () => {
    stub((c) => (path(c) === 'rpc/admin_users' ? json({ total: 0, rows: [], counts: {} }) : undefined));
    await run(listeners.onRequestGet as Handler, '/api/admin/listeners?q=bo&limit=12&platform=nokia&sort=evil&country=India');
    const b = calls.find((c) => path(c) === 'rpc/admin_users')?.body as Record<string, unknown>;
    expect(b).toMatchObject({ p_q: 'bo', p_limit: 12, p_platform: null, p_sort: 'last_active', p_country: null });
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?account=DROP')).res.status).toBe(400);
  });

  it('answers the filter choices and one profile (404 when unknown)', async () => {
    stub((c) => {
      if (path(c) === 'rpc/admin_user_filters') return json({ places: [{ country: 'IN', region: 'TG', city: 'Hyderabad', users: 3 }], versions: [], languages: [] });
      if (path(c) === 'rpc/user_profile') return json((c.body as { p_account: string }).p_account === ACCT ? { account: { id: ACCT }, devices: [] } : null);
      return undefined;
    });
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?filters=1')).body?.places).toHaveLength(1);
    expect((await run(listeners.onRequestGet as Handler, `/api/admin/listeners?account=${ACCT}`)).body?.profile).toEqual({ account: { id: ACCT }, devices: [], signIns: [], extras: null });
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?account=999')).res.status).toBe(404);
  });

  const account = (c: Call) => (path(c) === 'accounts' && c.method === 'GET' ? json([{ id: ACCT, email: 'a@x.in', name: 'Asha', listener_id: DEVICE, blocked_at: null }]) : undefined);

  it('blocks and unblocks, with an audit row', async () => {
    stub((c) => account(c) ?? (path(c) === 'accounts' && c.method === 'PATCH' ? json([{ id: ACCT }]) : undefined));
    const { body } = await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'block', account: ACCT, reason: 'spam' } });
    expect(body).toEqual({ ok: true, blocked: true });
    expect((calls.find((c) => c.method === 'PATCH')?.body as { blocked_at: string }).blocked_at).toMatch(/^\d{4}-/);
    expect((calls.find((c) => path(c) === 'audit_log')?.body as { action: string; summary: string })).toMatchObject({ action: 'user-block', summary: 'blocked a@x.in — spam' });
    await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'unblock', account: ACCT } });
    expect(calls.filter((c) => c.method === 'PATCH').pop()?.body).toEqual({ blocked_at: null });
  });

  it('signs one of the person’s devices out and refuses a device that is not theirs', async () => {
    stub((c) => account(c) ?? (path(c) === 'listeners' && c.method === 'GET' ? json([{ id: DEVICE }]) : undefined));
    const ok = await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'signout_device', account: ACCT, device: DEVICE } });
    expect(ok.body?.ok).toBe(true);
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => path(c))).toEqual(['listeners', 'accounts']);
    expect(patches[0].body).toMatchObject({ account_id: null });
    expect(typeof (patches[0].body as { signed_out_at: string }).signed_out_at).toBe('string');
    const other = await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'signout_device', account: ACCT, device: ANON } });
    expect(other.res.status).toBe(404);
  });

  it('filters by an owner tag through p_ids and shows each person’s tags (schema 15)', async () => {
    const OTHER = '110000000000000000002';
    stub((c) => {
      const p = path(c);
      if (p === 'owner_notes' && c.url.searchParams.get('tags')) {
        expect(c.url.searchParams.get('tags')).toBe('cs.{"vip"}');
        return json([{ account_id: ACCT }, { account_id: OTHER }]);
      }
      if (p === 'owner_notes') return json([{ account_id: ACCT, tags: ['vip', 'tester'] }]);
      if (p === 'rpc/admin_users') return json({ total: 1, rows: [{ id: ACCT, platform: 'web' }], counts: {} });
      return undefined;
    });
    const { body } = await run(listeners.onRequestGet as Handler, '/api/admin/listeners?tag=VIP');
    expect((calls.find((c) => path(c) === 'rpc/admin_users')?.body as Record<string, unknown>).p_ids).toEqual([ACCT, OTHER]);
    expect((body?.rows as Array<Record<string, unknown>>)[0].tags).toEqual(['vip', 'tester']);
    // With ?ids= too: only people on both lists.
    await run(listeners.onRequestGet as Handler, `/api/admin/listeners?tag=vip&ids=${OTHER},110000000000000000003`);
    expect((calls.filter((c) => path(c) === 'rpc/admin_users').pop()?.body as Record<string, unknown>).p_ids).toEqual([OTHER]);
  });

  it('a tag nobody carries matches nobody; a malformed tag is ignored', async () => {
    stub((c) => (path(c) === 'rpc/admin_users' ? json({ total: 0, rows: [], counts: {} }) : undefined));
    await run(listeners.onRequestGet as Handler, '/api/admin/listeners?tag=ghost');
    expect((calls.find((c) => path(c) === 'rpc/admin_users')?.body as Record<string, unknown>).p_ids).toEqual(['0']);
    calls = [];
    await run(listeners.onRequestGet as Handler, '/api/admin/listeners?tag=%7B%22x%22%7D');
    expect(calls.some((c) => path(c) === 'owner_notes')).toBe(false);
    expect((calls.find((c) => path(c) === 'rpc/admin_users')?.body as Record<string, unknown>).p_ids).toBeNull();
  });

  it('answers the owner’s tags with the filter choices and the profile extras (schema 15)', async () => {
    const extras = { hours: [{ hour: 21, seconds: 600 }], skips: 3, topSkipped: [], topReplayed: [], searches: [{ query: 'kanne', results: 0 }], notes: { tags: ['vip'], note: 'Friend from college' } };
    stub((c) => {
      if (path(c) === 'rpc/admin_user_filters') return json({ places: [], versions: [], languages: [] });
      if (path(c) === 'rpc/owner_tags') return json([{ tag: 'vip', users: 2 }]);
      if (path(c) === 'rpc/user_profile') return json({ account: { id: ACCT } });
      if (path(c) === 'rpc/profile_extras') return json(extras);
      return undefined;
    });
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?filters=1')).body?.tags).toEqual([{ tag: 'vip', users: 2 }]);
    expect(((await run(listeners.onRequestGet as Handler, `/api/admin/listeners?account=${ACCT}`)).body?.profile as Record<string, unknown>).extras).toEqual(extras);
  });

  it('before the database update the profile still opens and nobody has tags', async () => {
    const missing = () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    stub((c) => {
      if (path(c) === 'rpc/owner_tags' || path(c) === 'rpc/profile_extras') return missing();
      if (path(c) === 'owner_notes') return json({ code: '42P01', message: 'relation does not exist' }, 404);
      if (path(c) === 'rpc/admin_user_filters') return json({ places: [], versions: [], languages: [] });
      if (path(c) === 'rpc/user_profile') return json({ account: { id: ACCT } });
      if (path(c) === 'rpc/admin_users') return json({ total: 1, rows: [{ id: ACCT, platform: 'web' }], counts: {} });
      return undefined;
    });
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?filters=1')).body?.tags).toEqual([]);
    const prof = await run(listeners.onRequestGet as Handler, `/api/admin/listeners?account=${ACCT}`);
    expect(prof.res.status).toBe(200);
    expect((prof.body?.profile as Record<string, unknown>).extras).toBeNull();
    expect(((await run(listeners.onRequestGet as Handler, '/api/admin/listeners')).body?.rows as Array<Record<string, unknown>>)[0].tags).toEqual([]);
  });

  it('saves the owner’s tags and note, cleaned, with an audit row; viewers cannot', async () => {
    stub((c) => {
      if (path(c) === 'admins') return json([{ email: 'viewer@example.com', name: null, picture: null, role: 'viewer', invited_by: null, created_at: 'x', last_sign_in: null }]);
      if (path(c) === 'owner_notes' && c.method === 'GET') return json([{ account_id: ACCT, tags: ['friend'], note: 'Old note' }]);
      return account(c);
    });
    const { res, body } = await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'notes', account: ACCT, tags: [' VIP ', 'vip', 'Early   tester', '{bad}', 42], note: '  Met at the meetup  ' } });
    expect(res.status).toBe(200);
    expect((body?.notes as Record<string, unknown>)).toMatchObject({ tags: ['vip', 'early tester'], note: 'Met at the meetup' });
    const up = calls.find((c) => path(c) === 'owner_notes' && c.method === 'POST');
    expect(up?.url.searchParams.get('on_conflict')).toBe('account_id');
    expect(up?.body).toMatchObject({ account_id: ACCT, tags: ['vip', 'early tester'], note: 'Met at the meetup' });
    expect((calls.find((c) => path(c) === 'audit_log')?.body as { action: string; summary: string })).toMatchObject({ action: 'user-notes', summary: 'updated the notes and tags on a@x.in' });
    // Only the tags: the note stays.
    calls = [];
    await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'notes', account: ACCT, tags: [] } });
    expect(calls.find((c) => path(c) === 'owner_notes' && c.method === 'POST')?.body).toMatchObject({ tags: [], note: 'Old note' });
    expect((await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'notes', account: ACCT, tags: 'vip' } })).res.status).toBe(400);
    expect((await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'notes', account: ACCT, note: 5 } })).res.status).toBe(400);
    const viewer = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    expect((await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'notes', account: ACCT, tags: ['x'] }, token: viewer })).res.status).toBe(403);
  });

  it('cleanTags keeps at most 12 valid, unique, lower-case tags', () => {
    expect(listeners.cleanTags(null)).toBeNull();
    expect(listeners.cleanTags(['A', 'a', ' b c ', '-x', 'y'.repeat(25)])).toEqual(['a', 'b c']);
    expect(listeners.cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
  });

  it('only an owner deletes a person, across every device; viewers change nothing', async () => {
    stub((c) => {
      const p = path(c);
      if (p === 'admins') return json([{ email: (c.url.searchParams.get('email') ?? '').replace('eq.', ''), name: null, picture: null, role: c.url.searchParams.get('email')?.includes('viewer') ? 'viewer' : 'editor', invited_by: null, created_at: 'x', last_sign_in: null }]);
      if (p === 'listeners') return json([{ id: DEVICE }, { id: ANON }]);
      if (p === 'rpc/delete_listener') return json({ listener: 1, account: 1, events: 10 });
      return account(c);
    });
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    const viewer = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    expect((await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'delete', account: ACCT, reason: 'asked' }, token: editor })).res.status).toBe(403);
    expect((await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'block', account: ACCT }, token: viewer })).res.status).toBe(403);
    expect((await run(live.onRequestPost as Handler, '/api/admin/live', { body: { action: 'end_all_rooms' }, token: viewer })).res.status).toBe(403);
    expect((await run(listeners.onRequestGet as Handler, '/api/admin/listeners?filters=1', { token: viewer })).res.status).toBe(200);
    calls = [];
    const { res, body } = await run(listeners.onRequestPost as Handler, '/api/admin/listeners', { body: { action: 'delete', account: ACCT, reason: 'asked by them' } });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => path(c) === 'rpc/delete_listener').map((c) => c.body)).toEqual([
      { p_listener: DEVICE, p_account: ACCT }, { p_listener: ANON, p_account: ACCT },
    ]);
    expect(body?.deleted).toEqual({ listener: 2, account: 2, events: 20 });
    expect((calls.find((c) => path(c) === 'audit_log')?.body as { action: string }).action).toBe('user-delete');
  });
});

describe('Top Listeners and At Risk (schema 14)', () => {
  it('view=top reads stats_top_listeners with a 1–90 day window', async () => {
    stub((c) => (path(c) === 'rpc/stats_top_listeners' ? json({ since: '2026-11-07T00:00:00Z', people: 1, total: 600, rows: [{ id: ACCT, seconds: 600 }] }) : undefined));
    const r = await run(listeners.onRequestGet, '/api/admin/listeners?view=top&days=1');
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, days: 1, people: 1, total: 600, rows: [{ id: ACCT, seconds: 600 }] });
    expect(calls.find((c) => path(c) === 'rpc/stats_top_listeners')!.body).toEqual({ p_days: 1, p_limit: 100 });
    await run(listeners.onRequestGet, '/api/admin/listeners?view=top&days=999');
    expect(calls.filter((c) => path(c) === 'rpc/stats_top_listeners').at(-1)!.body).toEqual({ p_days: 7, p_limit: 100 });
  });

  it('view=at-risk reads stats_at_risk; quiet days stay within 1–60; unknown views are refused', async () => {
    stub((c) => (path(c) === 'rpc/stats_at_risk' ? json({ rule: { minSeconds: 7200, minDays: 5 }, total: 1, rows: [{ id: ACCT, lastActive: '2026-10-30T00:00:00Z' }] }) : undefined));
    const r = await run(listeners.onRequestGet, '/api/admin/listeners?view=at-risk&quiet=14');
    expect(r.body).toMatchObject({ configured: true, quiet: 14, total: 1, rule: { minDays: 5 } });
    expect(calls.find((c) => path(c) === 'rpc/stats_at_risk')!.body).toEqual({ p_quiet_days: 14, p_limit: 200 });
    await run(listeners.onRequestGet, '/api/admin/listeners?view=at-risk&quiet=0');
    expect(calls.filter((c) => path(c) === 'rpc/stats_at_risk').at(-1)!.body).toEqual({ p_quiet_days: 7, p_limit: 200 });
    expect((await run(listeners.onRequestGet, '/api/admin/listeners?view=nope')).res.status).toBe(400);
  });

  it('an older database answers db_update_needed', async () => {
    stub((c) => (path(c) === 'rpc/stats_top_listeners' ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : undefined));
    const r = await run(listeners.onRequestGet, '/api/admin/listeners?view=top');
    expect(r.res.status).toBe(502);
    expect(r.body?.error).toBe('db_update_needed');
  });
});

describe('Live Now', () => {
  it('lists signed-in people once each, drops anonymous devices and never sends device ids', async () => {
    const recent = new Date().toISOString();
    stub((c) => {
      const p = path(c);
      if (p === 'listeners' && c.url.searchParams.get('last_seen')) return json([
        { id: DEVICE, account_id: ACCT, platform: 'android', app_version: '1.8.3', country: 'IN', city: 'Hyderabad', now_playing: { title: 'Song', artist: 'A' }, is_playing: true, last_seen: recent },
        { id: 'd_' + 'ee'.repeat(16), account_id: ACCT, platform: 'web', app_version: null, country: 'IN', city: 'Hyderabad', now_playing: null, is_playing: false, last_seen: recent },
        { id: ANON, account_id: null, platform: 'web', app_version: null, country: 'US', city: null, now_playing: { title: 'X' }, is_playing: true, last_seen: recent },
      ]);
      if (p === 'listeners') return json([{ id: DEVICE, account_id: ACCT }, { id: ANON, account_id: null }]);
      if (p === 'accounts') return json(c.url.searchParams.get('id') || c.url.searchParams.get('listener_id') ? [{ id: ACCT, name: 'Asha', email: 'a@x.in', picture: null, listener_id: DEVICE }] : []);
      if (p === 'events') return json([
        { id: 2, at: recent, listener_id: ANON, kind: 'play', song_title: 'Hidden', song_artist: null, song_image: null, message: null, error_kind: null, platform: 'web', city: null },
        { id: 1, at: recent, listener_id: DEVICE, kind: 'play', song_title: 'Song', song_artist: 'A', song_image: null, message: null, error_kind: null, platform: 'android', city: 'Hyderabad' },
      ]);
      return undefined;
    });
    const { res, body } = await run(live.onRequestGet as Handler, '/api/admin/live');
    expect(res.status).toBe(200);
    expect(body?.counts).toEqual({ activeNow: 1, playingNow: 1, roomsOpen: 0 });
    expect((body?.listening as Array<{ user: { name: string } }>).map((l) => l.user.name)).toEqual(['Asha']);
    expect((body?.feed as Array<{ id: number }>).map((e) => e.id)).toEqual([1]);
    expect(JSON.stringify(body)).not.toMatch(/d_[a-f0-9]{8}/);
  });
});

describe('sign-in checks behind Block user and Sign out this device', () => {
  const AUTH = { GOOGLE_CLIENT_ID: '1-x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests', ...DB_ENV };
  const meReq = (s: string, device?: string) => new Request('https://example.test/api/auth/me', { headers: { authorization: `Bearer ${s}`, ...(device ? { 'x-vinax-device': device } : {}) } });
  beforeEach(() => resetGoogleKeys());

  it('a blocked account loses its session', async () => {
    fakeDb({ accounts: [{ id: '42', email: 'e@x', name: 'N', picture: null, listener_id: null, last_seen: new Date().toISOString(), blocked_at: '2026-11-01T00:00:00Z' }] });
    const me = await import('../functions/api/auth/me');
    const s = (await issueSession(AUTH, '42'))!;
    const r = await me.onRequestGet({ request: meReq(s), env: AUTH });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'signed_out', reason: 'blocked' });
  });

  it('a device signed out after the session was issued loses it; another device keeps working', async () => {
    const LAPTOP = 'd_' + '12'.repeat(16);
    const s = (await issueSession(AUTH, '42', Date.now() - 60_000))!;
    fakeDb({
      accounts: [{ id: '42', email: 'e@x', name: 'N', picture: null, listener_id: LAPTOP, last_seen: new Date().toISOString() }],
      listeners: [{ id: DEVICE, account_id: null, signed_out_at: new Date().toISOString() }, { id: LAPTOP, account_id: '42', signed_out_at: null }],
    });
    const me = await import('../functions/api/auth/me');
    const out = await me.onRequestGet({ request: meReq(s, await signId(AUTH.DEVICE_ID_SECRET, DEVICE)), env: AUTH });
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: 'signed_out', reason: 'device_signed_out' });
    expect((await me.onRequestGet({ request: meReq(s, await signId(AUTH.DEVICE_ID_SECRET, LAPTOP)), env: AUTH })).status).toBe(200);
    // A forged device header proves nothing and signs nobody out.
    expect((await me.onRequestGet({ request: meReq(s, `${DEVICE}.forged`), env: AUTH })).status).toBe(200);
  });

  it('a session issued AFTER the device was signed out (it signed in again) works', async () => {
    fakeDb({
      accounts: [{ id: '42', email: 'e@x', name: 'N', picture: null, listener_id: null, last_seen: new Date().toISOString() }],
      listeners: [{ id: DEVICE, account_id: '42', signed_out_at: new Date(Date.now() - 3_600_000).toISOString() }],
    });
    const me = await import('../functions/api/auth/me');
    const s = (await issueSession(AUTH, '42'))!;
    expect((await me.onRequestGet({ request: meReq(s, await signId(AUTH.DEVICE_ID_SECRET, DEVICE)), env: AUTH })).status).toBe(200);
  });

  it('Google sign-in refuses a blocked account before issuing a session', async () => {
    const fake = fakeDb({ accounts: [{ id: '42', blocked_at: '2026-11-01T00:00:00Z' }] });
    vi.doMock('../functions/_lib/googleAuth', async (orig) => ({ ...(await orig<typeof import('../functions/_lib/googleAuth')>()), verifyGoogleIdToken: async () => ({ sub: '42', email: 'e@x', emailVerified: true, name: 'N', picture: null }) }));
    vi.resetModules();
    const { onRequestPost } = await import('../functions/api/auth/google');
    const r = await onRequestPost({ request: new Request('https://example.test/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.9.9' }, body: JSON.stringify({ credential: 'x.y.z' }) }), env: AUTH });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'blocked' });
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    vi.doUnmock('../functions/_lib/googleAuth');
    vi.resetModules();
  });
});
