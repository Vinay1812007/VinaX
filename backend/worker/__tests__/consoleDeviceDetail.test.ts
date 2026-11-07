/**
 * Schema 16 — the console's device detail and time in the app: the Users
 * list gains seconds in the app per person (account_app_time, one call per
 * page), a profile gains appTime and per-device model / version / display
 * (profile_app_time), and Song Stats answers view=devices (device_breakdown).
 * Before the update those functions are missing: the answers stay as they were.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as listeners from '../functions/api/admin/listeners';
import * as analytics from '../functions/api/admin/analytics';
import { resetAdminMemo } from '../functions/_lib/adminAuth';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const TOKEN = 'owner-password-for-tests';
const ENV = { ADMIN_LOGIN_PASSWORD: TOKEN, AUTH_SECRET: 'auth-secret-for-tests', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
interface Call { url: URL; method: string; body: unknown }
let calls: Call[] = [];
function stub(respond: (c: Call) => Response | undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const call = { url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) as unknown : null };
    calls.push(call);
    return respond(call) ?? new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const missing = () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
const path = (c: Call) => c.url.pathname.replace('/rest/v1/', '');
type Handler = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
async function get(h: Handler, p: string) {
  const res = await h({ request: new Request(`https://admin.vinaxmusic.online${p}`, { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-admin-token': TOKEN } }), env: ENV });
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeEach(() => { resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

const A = '110000000000000000001', B = '110000000000000000002';
const users = () => json({ total: 2, rows: [{ id: A, platform: 'android' }, { id: B, platform: 'web' }], counts: {} });

describe('Users list: time in the app', () => {
  it('one account_app_time call for the page, merged per person (0 when nothing)', async () => {
    stub((c) => (path(c) === 'rpc/admin_users' ? users()
      : path(c) === 'rpc/account_app_time' ? json([{ account_id: A, seconds: '5400', today: 600 }]) : undefined));
    const { body } = await get(listeners.onRequestGet as Handler, '/api/admin/listeners');
    const call = calls.filter((c) => path(c) === 'rpc/account_app_time');
    expect(call).toHaveLength(1);
    expect((call[0].body as { p_accounts: string[] }).p_accounts).toEqual([A, B]);
    const rows = body?.rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ id: A, appTime30d: 5400, appToday: 600 });
    expect(rows[1]).toMatchObject({ id: B, appTime30d: 0, appToday: 0 });
  });

  it('before the update (no function) the rows come back as before', async () => {
    stub((c) => (path(c) === 'rpc/admin_users' ? users() : path(c) === 'rpc/account_app_time' ? missing() : undefined));
    const { res, body } = await get(listeners.onRequestGet as Handler, '/api/admin/listeners');
    expect(res.status).toBe(200);
    expect((body?.rows as Array<Record<string, unknown>>)[0]).not.toHaveProperty('appTime30d');
  });
});

describe('Profile: device detail and time in the app', () => {
  const profile = () => json({ account: { id: A }, devices: [{ id: 'd_1', platform: 'android' }, { id: 'd_2', platform: 'web' }] });
  it('merges model / version / display into each device and adds appTime', async () => {
    stub((c) => (path(c) === 'rpc/user_profile' ? profile()
      : path(c) === 'rpc/profile_app_time' ? json({ devices: [{ id: 'd_1', osVersion: '14', model: 'SM-S918B', brand: 'Samsung', display: 'app' }], today: 60, days7: 600, days30: '3600', all: 7200, byDay: [{ day: '2026-11-07', seconds: 60 }] })
        : undefined));
    const { body } = await get(listeners.onRequestGet as Handler, `/api/admin/listeners?account=${A}`);
    const p = body?.profile as Record<string, unknown>;
    expect(p.devices).toEqual([{ id: 'd_1', platform: 'android', osVersion: '14', model: 'SM-S918B', brand: 'Samsung', display: 'app' }, { id: 'd_2', platform: 'web' }]);
    expect(p.appTime).toEqual({ today: 60, days7: 600, days30: 3600, all: 7200, byDay: [{ day: '2026-11-07', seconds: 60 }] });
  });

  it('before the update the profile is unchanged', async () => {
    stub((c) => (path(c) === 'rpc/user_profile' ? profile() : path(c) === 'rpc/profile_app_time' ? missing() : undefined));
    const { body } = await get(listeners.onRequestGet as Handler, `/api/admin/listeners?account=${A}`);
    expect(body?.profile).toEqual({ account: { id: A }, devices: [{ id: 'd_1', platform: 'android' }, { id: 'd_2', platform: 'web' }], signIns: [], extras: null });
  });
});

describe('Song Stats view=devices', () => {
  it('calls device_breakdown with the window', async () => {
    stub((c) => (path(c) === 'rpc/device_breakdown' ? json({ days: 30, devices: 3, display: { app: 2, tab: 1 } }) : undefined));
    const { body } = await get(analytics.onRequestGet as Handler, '/api/admin/analytics?view=devices&days=30');
    expect(calls.find((c) => path(c) === 'rpc/device_breakdown')?.body).toEqual({ p_days: 30 });
    expect(body).toMatchObject({ view: 'devices', days: 30, data: { devices: 3, display: { app: 2, tab: 1 } } });
  });
});
