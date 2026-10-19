/**
 * 13.6.4 — User Management counts signed-in listeners, not only the ones who
 * share usage. Since 13.0 sign-in writes vinax_accounts; vinax_users gets a
 * row only after the (unticked) usage opt-in, so new listeners never showed.
 * Drives the real handlers against a stubbed database REST layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as users } from '../functions/api/admin/users';
import { onRequestGet as user } from '../functions/api/admin/user';
import { onRequestPost as maintenance } from '../functions/api/admin/maintenance';
import { touchAccount, TOUCH_MS } from '../functions/api/auth/me';
import { signDeviceId } from '../functions/_lib/deviceid';

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', DEVICE_ID_SECRET: 'device-secret' };

interface Call { url: string; method: string; body: string | null }
const calls: Call[] = [];
type Route = [match: (url: string, method: string) => boolean, make: (url: string) => Response];
const json = (v: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

function db(routes: Route[]): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? String(init.body) : null });
    for (const [match, make] of routes) if (match(url, method)) return Promise.resolve(make(url));
    return Promise.resolve(new Response('[]', { status: 200 }));
  });
}

let ip = 0;
function req(path: string, method = 'GET', body?: unknown): Request {
  ip += 1;
  return new Request(`https://admin.test${path}`, {
    method,
    headers: { 'x-admin-token': 'test-secret', 'content-type': 'application/json', 'cf-connecting-ip': `10.44.0.${ip % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const H = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const DEVICES = [
  { device_id: 'c_aaa', name: 'Gaming', username: null, platform: 'web', country: 'IN', city: 'Hyderabad', is_playing: false, first_seen: H(120), last_seen: H(4) },
  { device_id: 'c_bbb', name: null, username: null, platform: 'android', country: 'IN', city: 'Hyderabad', is_playing: false, first_seen: H(100), last_seen: H(48) },
];
const ACCOUNTS = [
  { google_sub: '1001', name: 'New Listener', username: null, email: 'new@example.com', picture: 'https://lh3.example/a.jpg', country: 'IN', region: 'TG', city: 'Hyderabad', platform: 'android', app_version: '13.7.0', device_id: null, created_at: H(2), last_seen: H(1) },
  { google_sub: '1002', name: 'Older Account', username: 'old', device_id: null, created_at: H(90), last_seen: H(30) },
];
const SUMMARY = { total_users: 2, active_24h: 1, new_24h: 0, total_plays: 13 };

function countOf(url: string): number {
  if (url.includes('created_at=gte.')) return 1;
  if (url.includes('last_seen=gte.')) return 1;
  if (url.includes('device_id=is.null')) return 2;
  return 3; // every account, one of them linked to c_bbb
}
const happy: Route[] = [
  [(u) => u.includes('/rpc/vinax_user_summary'), () => json(SUMMARY)],
  [(u) => u.includes('/vinax_accounts') && u.includes('device_id=in.'), () => json([{ device_id: 'c_bbb', name: 'Bhagya', username: 'bhagya', email: 'bhagya@example.com', picture: 'https://lh3.example/b.jpg' }])],
  [(u) => u.includes('/vinax_accounts') && u.includes('select=*&limit=1'), (u) => json([], { 'content-range': `0-0/${countOf(u)}` })],
  [(u) => u.includes('/vinax_accounts') && u.includes('select=google_sub'), () => json(ACCOUNTS)],
  [(u) => u.includes('/vinax_users'), () => json(DEVICES.map((d) => ({ ...d })))],
];

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/admin/users — accounts and usage rows together', () => {
  it('lists a signed-in listener who never shared usage, newest first, and counts them', async () => {
    db(happy);
    const res = await users({ request: req('/api/admin/users?limit=50&offset=0'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<Record<string, unknown>>; summary: Record<string, number>; hasMore: boolean; unavailable?: string[] };
    expect(body.users.map((u) => u.device_id)).toEqual(['account:1001', 'c_aaa', 'account:1002', 'c_bbb']);
    // 13.7 — an account row carries its Gmail, photo and coarse sign-in facts.
    expect(body.users[0]).toMatchObject({ kind: 'account', name: 'New Listener', email: 'new@example.com', picture: 'https://lh3.example/a.jpg', city: 'Hyderabad', country: 'IN', platform: 'android', app_version: '13.7.0', first_seen: ACCOUNTS[0].created_at });
    // A linked device carries the account's name, username, Gmail and photo.
    expect(body.users[3]).toMatchObject({ signed_in: true, name: 'Bhagya', username: 'bhagya', email: 'bhagya@example.com', picture: 'https://lh3.example/b.jpg' });
    expect(body.summary).toEqual({ total_users: 4, active_24h: 2, new_24h: 1, total_plays: 13, accounts_total: 3 });
    expect(body.hasMore).toBe(false);
    expect(body.unavailable).toBeUndefined();
    // Only unlinked accounts become their own rows.
    const accRead = calls.find((c) => c.url.includes('/vinax_accounts') && c.url.includes('select=google_sub'))!;
    expect(accRead.url).toContain('device_id=is.null');
  });

  it('pages over the merged list exactly', async () => {
    db(happy);
    const p1 = (await (await users({ request: req('/api/admin/users?limit=3&offset=0'), env: ENV })).json()) as { users: Array<{ device_id: string }>; hasMore: boolean };
    expect(p1.users.map((u) => u.device_id)).toEqual(['account:1001', 'c_aaa', 'account:1002']);
    expect(p1.hasMore).toBe(true);
    const p2 = (await (await users({ request: req('/api/admin/users?limit=3&offset=3'), env: ENV })).json()) as { users: Array<{ device_id: string }>; hasMore: boolean };
    expect(p2.users.map((u) => u.device_id)).toEqual(['c_bbb']);
    expect(p2.hasMore).toBe(false);
  });

  it('a search reaches account names too', async () => {
    db(happy);
    await users({ request: req('/api/admin/users?q=New'), env: ENV });
    const accRead = calls.find((c) => c.url.includes('/vinax_accounts') && c.url.includes('select=google_sub'))!;
    expect(accRead.url).toContain('or=(name.ilike.*New*,username.ilike.*New*,email.ilike.*New*)');
  });

  it('a Gmail search finds a linked device too', async () => {
    db([
      [(u) => u.includes('/vinax_accounts') && u.includes('device_id=not.is.null'), () => json([{ device_id: 'c_bbb' }])],
      ...happy,
    ]);
    await users({ request: req('/api/admin/users?q=bhagya@example'), env: ENV });
    const devRead = calls.find((c) => c.url.includes('/vinax_users'))!;
    expect(devRead.url).toContain('device_id.in.("c_bbb")');
  });

  it('before the 13.7 columns exist the account list still loads, without them', async () => {
    db([
      [(u) => u.includes('/vinax_accounts') && u.includes('select=google_sub') && u.includes('country'), () => new Response('{"code":"42703"}', { status: 400 })],
      ...happy,
    ]);
    const body = (await (await users({ request: req('/api/admin/users'), env: ENV })).json()) as { users: Array<{ device_id: string }>; unavailable?: string[] };
    expect(body.unavailable).toBeUndefined();
    expect(body.users.map((u) => u.device_id)).toContain('account:1001');
  });

  it('a failed account read keeps the usage list and names what is missing', async () => {
    db([[(u) => u.includes('/vinax_accounts'), () => new Response('{}', { status: 500 })], ...happy]);
    const res = await users({ request: req('/api/admin/users'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ device_id: string }>; summary: Record<string, unknown>; unavailable: string[] };
    expect(body.users.map((u) => u.device_id)).toEqual(['c_aaa', 'c_bbb']);
    expect(body.summary).toMatchObject({ total_users: 2, accounts_total: null });
    expect(body.unavailable).toEqual(['accounts']);
  });

  it('reads past the 1000-row cap in chunks', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...DEVICES[0], device_id: `c_${String(i).padStart(4, '0')}`, last_seen: H(5 + i / 100) }));
    db([
      [(u) => u.includes('/vinax_users') && u.includes('offset=0'), () => json(many)],
      [(u) => u.includes('/vinax_users') && u.includes('offset=1000'), () => json([{ ...DEVICES[1], last_seen: H(500) }])],
      ...happy.filter((r) => !r[0]('/vinax_users', 'GET')),
    ]);
    const body = (await (await users({ request: req('/api/admin/users?limit=100&offset=950'), env: ENV })).json()) as { users: Array<{ device_id: string }> };
    expect(calls.filter((c) => c.url.includes('/vinax_users')).map((c) => c.url.match(/limit=\d+&offset=\d+/)?.[0])).toEqual(['limit=1000&offset=0', 'limit=51&offset=1000']);
    expect(body.users.at(-1)?.device_id).toBe('c_bbb');
  });
});

describe('account rows in the drill-down and delete', () => {
  it('an unlinked account answers with its own record and no plays; a linked one with its device', async () => {
    db([[(u) => u.includes('/vinax_accounts'), () => json([ACCOUNTS[0]])]]);
    let body = (await (await user({ request: req('/api/admin/user?deviceId=account:1001'), env: ENV })).json()) as { user: Record<string, unknown>; events: unknown[] };
    expect(body.user).toMatchObject({ device_id: 'account:1001', kind: 'account', name: 'New Listener' });
    expect(body.events).toEqual([]);
    expect(calls.some((c) => c.url.includes('/vinax_events'))).toBe(false);

    db([
      [(u) => u.includes('/vinax_accounts'), () => json([{ ...ACCOUNTS[0], device_id: 'c_bbb' }])],
      [(u) => u.includes('/vinax_users'), () => json([DEVICES[1]])],
      [(u) => u.includes('/vinax_events'), () => json([{ type: 'play', song_title: 'X', created_at: H(1) }])],
    ]);
    body = (await (await user({ request: req('/api/admin/user?deviceId=account:1001'), env: ENV })).json()) as typeof body;
    expect(body.user).toMatchObject({ device_id: 'c_bbb' });
    expect(body.events).toHaveLength(1);
    expect(calls.find((c) => c.url.includes('/vinax_events'))!.url).toContain('device_id=eq.c_bbb');
  });

  it('deleting an account row deletes the account; deleting a device unlinks its account', async () => {
    db([[(u, m) => m === 'DELETE' && u.includes('/vinax_accounts'), () => json([{ google_sub: '1001' }])]]);
    let res = await maintenance({ request: req('/api/admin/maintenance', 'POST', { action: 'delete_user', device_id: 'account:1001', reason: 'test cleanup' }), env: ENV });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('vinax_accounts?google_sub=eq.1001'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/vinax_users') || c.url.includes('/vinax_events'))).toBe(false);

    db([[(u, m) => m === 'DELETE' && u.includes('/vinax_users'), () => json([{ device_id: 'c_bbb' }])]]);
    res = await maintenance({ request: req('/api/admin/maintenance', 'POST', { action: 'delete_user', device_id: 'c_bbb', reason: 'test cleanup' }), env: ENV });
    expect(res.status).toBe(200);
    const unlink = calls.find((c) => c.method === 'PATCH' && c.url.includes('/vinax_accounts'))!;
    expect(unlink.url).toContain('device_id=eq.c_bbb');
    expect(JSON.parse(unlink.body!)).toEqual({ device_id: null });
  });
});

describe('GET /api/auth/me links the device and keeps last_seen current', () => {
  const row = (over: Record<string, unknown> = {}) => ({ google_sub: '1001', device_id: null, last_seen: new Date().toISOString(), ...over });
  const meReq = (signed?: string) => new Request('https://example.test/api/auth/me', { headers: signed ? { 'x-vinax-device': signed } : {} });

  it('a valid signed device id links the device', async () => {
    db([]);
    const signed = await signDeviceId('c_newdevice', ENV.DEVICE_ID_SECRET);
    expect(await touchAccount(meReq(signed), ENV, row())).toBe(true);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('vinax_accounts?google_sub=eq.1001');
    expect(JSON.parse(patch.body!)).toMatchObject({ device_id: 'c_newdevice' });
  });

  it('a forged id links nothing; a fresh last_seen writes nothing; a stale one is refreshed', async () => {
    db([]);
    expect(await touchAccount(meReq('c_forged.sig'), ENV, row())).toBe(false);
    expect(await touchAccount(meReq(), ENV, row())).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await touchAccount(meReq(), ENV, row({ last_seen: new Date(Date.now() - TOUCH_MS - 1000).toISOString() }))).toBe(true);
    const patch = JSON.parse(calls[0].body!) as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['last_seen', 'country', 'region', 'city']);
  });

  it('the same device already linked is not rewritten', async () => {
    db([]);
    const signed = await signDeviceId('c_same', ENV.DEVICE_ID_SECRET);
    expect(await touchAccount(meReq(signed), ENV, row({ device_id: 'c_same' }))).toBe(false);
  });
});
