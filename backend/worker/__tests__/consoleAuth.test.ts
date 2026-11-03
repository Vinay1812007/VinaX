/**
 * Console rebuild — console sign-in and roles: admin sessions (issue, read, expiry,
 * forgery), the principal behind a token (Google admin from `admins`, the
 * owner recovery password, bootstrap owners), role gating on every write
 * (viewer 403, editor allowed, owner-only actions), POST /api/admin/session
 * (only listed, verified emails get in) and Admins & Roles (owner-only, the
 * last owner cannot be removed or demoted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/googleAuth', async (orig) => {
  const real = await orig<typeof import('../functions/_lib/googleAuth')>();
  return { ...real, verifyGoogleIdToken: vi.fn(async (_env: unknown, token: unknown) => (token === 'good-google-token' ? { sub: '123', email: 'Editor@Example.com', emailVerified: true, name: 'Eddie', picture: 'https://pic.test/e.png' } : token === 'stranger-token' ? { sub: '9', email: 'stranger@example.com', emailVerified: true, name: 'S', picture: null } : token === 'unverified-token' ? { sub: '8', email: 'editor@example.com', emailVerified: false, name: null, picture: null } : null)) };
});

import { adminPrincipal } from '../functions/_lib/admin';
import { ADMIN_SESSION_TTL_S, issueAdminSession, readAdminSession, resetAdminMemo, roleAllows } from '../functions/_lib/adminAuth';
import { adminPost } from '../functions/_lib/adminRoute';
import * as session from '../functions/api/admin/session';
import * as admins from '../functions/api/admin/admins';
import * as database from '../functions/api/admin/database';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'auth-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com', ...DB };

interface Call { url: URL; method: string; body: unknown }
let calls: Call[] = [];
let adminsTable: Array<Record<string, unknown>> = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/** A tiny PostgREST: the admins table, audit inserts, meta. */
function stub(): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    const table = url.pathname.replace('/rest/v1/', '');
    const emailEq = url.searchParams.get('email')?.replace(/^eq\./, '');
    if (table === 'admins') {
      if (method === 'GET') return json(emailEq ? adminsTable.filter((r) => r.email === emailEq) : adminsTable);
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) { const i = adminsTable.findIndex((x) => x.email === r.email); if (i >= 0) adminsTable[i] = { ...adminsTable[i], ...r }; else adminsTable.push({ name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null, ...r }); }
        return json(rows, 201);
      }
      if (method === 'PATCH') { const out = adminsTable.filter((r) => r.email === emailEq).map((r) => Object.assign(r, body)); return json(out); }
      if (method === 'DELETE') { const out = adminsTable.filter((r) => r.email === emailEq); adminsTable = adminsTable.filter((r) => r.email !== emailEq); return json(out); }
    }
    if (table === 'audit_log') return json([], 201);
    if (table === 'meta') return json([{ value: { version: 10 } }]);
    if (table === 'settings') return json([]);
    return json([]);
  }));
}
const req = (path: string, token?: string, body?: unknown) => new Request(`https://admin.vinaxmusic.online${path}`, {
  method: body !== undefined ? 'POST' : 'GET',
  headers: { 'cf-connecting-ip': '203.0.113.20', ...(token ? { 'x-admin-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const call = async (h: unknown, r: Request, env: Record<string, unknown> = ENV) => {
  const res = await (h as H)({ request: r, env });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeEach(() => {
  resetAdminMemo(); resetSettingsMemo(); _resetRateLimitsForTests();
  adminsTable = [
    { email: 'boss@example.com', role: 'owner', name: 'Boss', picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    { email: 'editor@example.com', role: 'editor', name: null, picture: null, invited_by: 'boss@example.com', created_at: 't', last_sign_in: null },
    { email: 'viewer@example.com', role: 'viewer', name: null, picture: null, invited_by: 'boss@example.com', created_at: 't', last_sign_in: null },
  ];
  stub();
});
afterEach(() => vi.unstubAllGlobals());

describe('admin sessions', () => {
  it('reads back the email it issued, and refuses expired, forged and malformed tokens', async () => {
    const now = Date.now();
    const t = (await issueAdminSession(ENV, 'boss@example.com', now))!;
    expect(t.startsWith('adm1.')).toBe(true);
    expect(await readAdminSession(ENV, t, now)).toBe('boss@example.com');
    expect(await readAdminSession(ENV, t, now + (ADMIN_SESSION_TTL_S + 5) * 1000)).toBeNull();
    const [a, p, s] = t.split('.');
    const forgedPayload = btoa(JSON.stringify({ email: 'evil@example.com', iat: 1, exp: 9e9 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(await readAdminSession(ENV, `${a}.${forgedPayload}.${s}`, now)).toBeNull();
    expect(await readAdminSession(ENV, `${a}.${p}.${s.slice(0, -2)}xx`, now)).toBeNull();
    expect(await readAdminSession({ ...ENV, AUTH_SECRET: 'other-secret' }, t, now)).toBeNull();
    expect(await readAdminSession(ENV, 'adm1.nope', now)).toBeNull();
    expect(await issueAdminSession({}, 'x@y.z')).toBeNull();
  });

  it('ranks roles viewer < editor < owner', () => {
    expect(roleAllows('owner', 'editor')).toBe(true);
    expect(roleAllows('editor', 'owner')).toBe(false);
    expect(roleAllows('viewer', 'editor')).toBe(false);
    expect(roleAllows('viewer', 'viewer')).toBe(true);
  });
});

describe('who is calling', () => {
  it('a Google session takes its role from the admins table, the password is an owner', async () => {
    const t = (await issueAdminSession(ENV, 'editor@example.com'))!;
    expect(await adminPrincipal(req('/x', t), ENV)).toMatchObject({ email: 'editor@example.com', role: 'editor', via: 'google' });
    expect(await adminPrincipal(req('/x', 'owner-pass'), ENV)).toMatchObject({ email: 'owner', role: 'owner', via: 'password' });
    expect(await adminPrincipal(req('/x', 'wrong'), ENV)).toBeNull();
    expect(await adminPrincipal(req('/x'), ENV)).toBeNull();
  });

  it('a removed admin loses access; a bootstrap owner needs no row', async () => {
    const gone = (await issueAdminSession(ENV, 'gone@example.com'))!;
    expect(await adminPrincipal(req('/x', gone), ENV)).toBeNull();
    const boot = (await issueAdminSession(ENV, 'founder@example.com'))!;
    expect(await adminPrincipal(req('/x', boot), { ...ENV, ADMIN_OWNER_EMAILS: 'Founder@Example.com, other@x.io' })).toMatchObject({ role: 'owner' });
  });

  it('refuses when the admins table cannot be read (never guesses a role)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'down' }, 503)));
    const t = (await issueAdminSession(ENV, 'editor@example.com'))!;
    expect(await adminPrincipal(req('/x', t), ENV)).toBeNull();
  });
});

describe('role gating on writes', () => {
  const handler = adminPost(async () => json({ ok: true }));
  const ownerOnly = adminPost(async () => json({ ok: true }), { role: (b) => (b.action === 'danger' ? 'owner' : 'editor') });

  it('viewer 403, editor allowed, owner-only actions 403 for editors', async () => {
    const viewer = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    expect((await call(handler, req('/x', viewer, {}))).status).toBe(403);
    expect((await call(handler, req('/x', viewer, {}))).body).toEqual({ error: 'forbidden', need: 'editor' });
    expect((await call(handler, req('/x', editor, {}))).status).toBe(200);
    expect((await call(ownerOnly, req('/x', editor, { action: 'safe' }))).status).toBe(200);
    expect((await call(ownerOnly, req('/x', editor, { action: 'danger' }))).body).toEqual({ error: 'forbidden', need: 'owner' });
    expect((await call(ownerOnly, req('/x', 'owner-pass', { action: 'danger' }))).status).toBe(200);
    expect((await call(handler, req('/x', undefined, {}))).status).toBe(401);
  });

  it('database writes are owner-only', async () => {
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    expect((await call(database.onRequestPost, req('/api/admin/database', editor, { action: 'sweep_rooms' }))).status).toBe(403);
  });

  it('audit rows name the admin who made the change', async () => {
    const boss = (await issueAdminSession(ENV, 'boss@example.com'))!;
    await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'invite', email: 'new@example.com', role: 'viewer' }));
    const row = calls.find((c) => c.url.pathname.endsWith('/audit_log') && c.method === 'POST')?.body as { actor: string };
    expect(row.actor).toBe('boss@example.com');
  });
});

describe('POST /api/admin/session', () => {
  it('signs in a listed, verified Google email with its role', async () => {
    const r = await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'good-google-token' }));
    expect(r.status).toBe(200);
    expect(r.body?.me).toMatchObject({ email: 'editor@example.com', role: 'editor', via: 'google' });
    expect(await readAdminSession(ENV, String(r.body?.token))).toBe('editor@example.com');
    expect(calls.some((c) => c.url.pathname.endsWith('/admins') && c.method === 'PATCH')).toBe(true); // name, photo, last sign-in
  });

  it('refuses emails not on the list, unverified emails and bad tokens', async () => {
    expect(await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'stranger-token' }))).toMatchObject({ status: 403, body: { error: 'not_an_admin', email: 'stranger@example.com' } });
    expect((await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'unverified-token' }))).body?.error).toBe('email_not_verified');
    expect((await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'forged' }))).status).toBe(401);
    expect((await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'good-google-token' }), { ...DB })).body?.error).toBe('google_not_configured');
  });

  it('a bootstrap owner gets in and is written to the list', async () => {
    adminsTable = [];
    const r = await call(session.onRequestPost, req('/api/admin/session', undefined, { credential: 'good-google-token' }), { ...ENV, ADMIN_OWNER_EMAILS: 'editor@example.com' });
    expect(r.body?.me).toMatchObject({ role: 'owner' });
    expect(adminsTable[0]).toMatchObject({ email: 'editor@example.com', role: 'owner' });
  });

  it('GET tells the sign-in screen what it needs, and who is signed in', async () => {
    const anon = await call(session.onRequestGet, req('/api/admin/session'));
    expect(anon.body).toMatchObject({ googleReady: true, passwordAllowed: true, me: null, googleClientId: '1-abc.apps.googleusercontent.com' });
    const t = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    const me = await call(session.onRequestGet, req('/api/admin/session', t));
    expect(me.body).toMatchObject({ me: { email: 'viewer@example.com', role: 'viewer' }, schema: 10, schemaWanted: 10 });
  });
});

describe('Admins & Roles', () => {
  it('lists admins for any admin; only owners change the list', async () => {
    const viewer = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    const editor = (await issueAdminSession(ENV, 'editor@example.com'))!;
    const list = await call(admins.onRequestGet, req('/api/admin/admins', viewer));
    expect((list.body?.rows as unknown[]).length).toBe(3);
    expect((await call(admins.onRequestPost, req('/api/admin/admins', editor, { action: 'invite', email: 'x@example.com', role: 'viewer' }))).status).toBe(403);
  });

  it('invites, changes a role, removes; refuses duplicates and bad input', async () => {
    const boss = (await issueAdminSession(ENV, 'boss@example.com'))!;
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'invite', email: ' New@Example.com ', role: 'editor' }))).status).toBe(200);
    expect(adminsTable.find((r) => r.email === 'new@example.com')).toMatchObject({ role: 'editor', invited_by: 'boss@example.com' });
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'invite', email: 'new@example.com', role: 'editor' }))).status).toBe(409);
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'invite', email: 'not-an-email', role: 'editor' }))).body?.error).toBe('bad_email');
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'invite', email: 'z@example.com', role: 'king' }))).body?.error).toBe('bad_role');
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'role', email: 'new@example.com', role: 'viewer' }))).status).toBe(200);
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'remove', email: 'new@example.com' }))).status).toBe(200);
    expect(adminsTable.some((r) => r.email === 'new@example.com')).toBe(false);
  });

  it('never leaves the console without an owner', async () => {
    const boss = (await issueAdminSession(ENV, 'boss@example.com'))!;
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'role', email: 'boss@example.com', role: 'editor' }))).body?.error).toBe('last_owner');
    expect((await call(admins.onRequestPost, req('/api/admin/admins', boss, { action: 'remove', email: 'boss@example.com' }))).body?.error).toBe('last_owner');
  });
});
