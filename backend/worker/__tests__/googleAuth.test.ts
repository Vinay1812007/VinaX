/**
 * 12.2 — Google sign-in: ID tokens are checked against Google's keys (here a
 * key pair made in the test, served by a mocked key endpoint), sessions are
 * signed and expire. Without a database the routes answer from the session
 * alone; with one (14.0) the `accounts` row is written at sign-in and read on
 * the session check. No network beyond the mocked key endpoint and the fake
 * database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSession, readSession, resetGoogleKeys, verifyGoogleIdToken } from '../functions/_lib/googleAuth';
import { idFromInstall, signId } from '../functions/_lib/identity';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const CLIENT = '152181244509-test.apps.googleusercontent.com';
const ENV = { GOOGLE_CLIENT_ID: CLIENT, AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests' };

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey;
async function token(claims: Record<string, unknown>, kid = 'k1', signer = keys.privateKey): Promise<string> {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const now = Math.floor(Date.now() / 1000);
const good = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '110000000000000000001', email: 'listener@example.com', email_verified: true, name: 'A Listener', picture: 'https://lh3.example/p.jpg', iat: now, exp: now + 3600, ...over });

interface Call { url: string; method: string; body: Record<string, unknown> | null }
function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null; } catch { /* not JSON */ }
    calls.push({ url, method, body });
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
    return new Response(null, { status: 201 });
  }));
  return calls;
}

beforeEach(async () => {
  resetGoogleKeys();
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
});
afterEach(() => vi.unstubAllGlobals());

describe('verifyGoogleIdToken', () => {
  it('accepts a token Google signed for this app, and reads the profile', async () => {
    stub();
    expect(await verifyGoogleIdToken(ENV, await token(good()))).toEqual({ sub: '110000000000000000001', email: 'listener@example.com', emailVerified: true, name: 'A Listener', picture: 'https://lh3.example/p.jpg' });
  });

  it('refuses another audience, another issuer, an expired token, a forged signature, an unknown key and junk', async () => {
    stub();
    expect(await verifyGoogleIdToken(ENV, await token(good({ aud: 'someone-else.apps.googleusercontent.com' })))).toBeNull();
    expect(await verifyGoogleIdToken(ENV, await token(good({ iss: 'https://evil.example' })))).toBeNull();
    expect(await verifyGoogleIdToken(ENV, await token(good({ exp: now - 600 })))).toBeNull();
    const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifyGoogleIdToken(ENV, await token(good(), 'k1', other.privateKey))).toBeNull();
    expect(await verifyGoogleIdToken(ENV, await token(good(), 'unknown-kid'))).toBeNull();
    for (const junk of [null, '', 'a.b', 'x'.repeat(5000), 42]) expect(await verifyGoogleIdToken(ENV, junk)).toBeNull();
    expect(await verifyGoogleIdToken({ ...ENV, GOOGLE_CLIENT_ID: '' }, await token(good()))).toBeNull();
  });
});

describe('sessions', () => {
  it('a session reads back its account; a changed, expired or foreign one does not', async () => {
    const s = (await issueSession(ENV, '42'))!;
    expect(s).toMatch(/^vx1\.[\w-]+\.[\w-]+$/);
    expect(await readSession(ENV, s)).toBe('42');
    expect(await readSession(ENV, s.slice(0, -2) + 'xx')).toBeNull();
    expect(await readSession({ ...ENV, AUTH_SECRET: 'another' }, s)).toBeNull();
    expect(await readSession(ENV, s, Date.now() + 31 * 24 * 3600 * 1000)).toBeNull();
    expect(await issueSession({}, '42')).toBeNull();
  });
});

describe('POST /api/auth/google and /api/auth/me', () => {
  const post = (body: unknown): Request => new Request('https://example.test/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.99.0.1' }, body: JSON.stringify(body) });

  it('without a database: signs in from the Google token alone, stores nothing, and the session opens /api/auth/me', async () => {
    const { onRequestPost } = await import('../functions/api/auth/google');
    const calls = stub();
    const res = await onRequestPost({ request: post({ credential: await token(good()), signed_device_id: 'forged.value' }), env: ENV });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { session: string; stored: boolean; user: Record<string, unknown> };
    expect(out.user).toEqual({ name: 'A Listener', email: 'listener@example.com', picture: 'https://lh3.example/p.jpg', username: null });
    expect(out.stored).toBe(false);
    // Only Google's key endpoint is ever called.
    expect(calls.every((c) => c.url.startsWith('https://www.googleapis.com/'))).toBe(true);
    const me = await import('../functions/api/auth/me');
    const r = await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: `Bearer ${out.session}` } }), env: ENV });
    expect(r.status).toBe(200);
    // No `user`: the app keeps the profile it got at sign-in.
    expect(await r.json()).toEqual({ ok: true });
    const no = await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: 'Bearer vx1.bad.sig' } }), env: ENV });
    expect(no.status).toBe(401);
  });

  it('a bad token is 401; no client id is 503; the key never reaches the reply', async () => {
    const { onRequestPost } = await import('../functions/api/auth/google');
    stub();
    expect((await onRequestPost({ request: post({ credential: 'nope' }), env: ENV })).status).toBe(401);
    expect((await onRequestPost({ request: post({ credential: await token(good()) }), env: { AUTH_SECRET: 'x' } })).status).toBe(503);
    const ok = await onRequestPost({ request: post({ credential: await token(good()) }), env: ENV });
    expect(await ok.text()).not.toContain('auth-secret-for-tests');
  });

  it('deleting the account needs a session and touches nothing remote', async () => {
    const { issueSession: issue } = await import('../functions/_lib/googleAuth');
    const me = await import('../functions/api/auth/me');
    const calls = stub();
    const s = (await issue(ENV, '110000000000000000001')) as string;
    const del = (session: string) => new Request('https://example.test/api/auth/me', { method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json', 'cf-connecting-ip': '10.99.0.2' }, body: JSON.stringify({ delete: true }) });
    const res = await me.onRequestPost({ request: del(s), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
    expect((await me.onRequestPost({ request: del('vx1.bad.sig'), env: ENV })).status).toBe(401);
  });
});

describe('14.0 — sign-in with the database', () => {
  const DB = { ...ENV, ...DB_ENV };
  const googleKeys = (url: string) => (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')
    ? new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } })
    : new Response('{}', { status: 404 }));
  const post = (body: unknown, headers: Record<string, string> = {}): Request => new Request('https://example.test/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.99.1.1', 'cf-ipcountry': 'IN', ...headers }, body: JSON.stringify(body) });
  const LISTENER = 'd_' + 'ef'.repeat(16);

  it('writes the account row, links only a PROVED device, and answers the linked handle', async () => {
    const fake = fakeDb({ listeners: [{ id: LISTENER, handle: 'vinay' }] }, googleKeys);
    const { onRequestPost } = await import('../functions/api/auth/google');
    // A forged device claim links nothing.
    const first = await onRequestPost({ request: post({ credential: await token(good()), signed_device_id: `${LISTENER}.forged`, platform: 'android', appVersion: '14.0.0' }), env: DB });
    expect(first.status).toBe(200);
    const out1 = (await first.json()) as { stored: boolean; returning: boolean; hasData: boolean; user: { username: string | null } };
    expect(out1.stored).toBe(true);
    // A first sign-in is a new account with nothing synced yet.
    expect(out1.returning).toBe(false);
    expect(out1.hasData).toBe(false);
    expect(out1.user.username).toBeNull();
    expect(fake.rows('accounts')[0]).toMatchObject({ id: '110000000000000000001', email: 'listener@example.com', email_verified: true, name: 'A Listener', listener_id: null, platform: 'android', app_version: '14.0.0', country: 'IN' });
    // The real signed id links the device and the handle comes back.
    const signed = await signId(ENV.DEVICE_ID_SECRET, LISTENER);
    const second = await onRequestPost({ request: post({ credential: await token(good()), signed_device_id: signed }), env: DB });
    const out2 = (await second.json()) as { returning: boolean; hasData: boolean; user: { username: string | null } };
    expect(out2.user.username).toBe('vinay');
    // The same Google account again: returning, still without a synced copy.
    expect(out2.returning).toBe(true);
    expect(out2.hasData).toBe(false);
    // Once it has synced, a sign-in on another browser says so.
    fake.tables.account_backups = [{ account_id: '110000000000000000001', payload: {}, version: 3 }];
    const third = (await (await onRequestPost({ request: post({ credential: await token(good()) }), env: DB })).json()) as { returning: boolean; hasData: boolean };
    expect(third).toMatchObject({ returning: true, hasData: true });
    expect(fake.rows('accounts')).toHaveLength(1);
    expect(fake.rows('accounts')[0].listener_id).toBe(LISTENER);
    // The proved device carries its account (the console folds devices per person).
    expect(fake.rows('listeners').find((l) => l.id === LISTENER)?.account_id).toBe('110000000000000000001');
  });

  it('V2 1.0.1 — a browser that never reported usage is linked by its install id, and gets its signed id', async () => {
    const fake = fakeDb({}, googleKeys);
    const { onRequestPost } = await import('../functions/api/auth/google');
    const install = '3f0c1a52-7d7e-4bb4-9d2e-6c1b8a0e5f11';
    const res = await onRequestPost({ request: post({ credential: await token(good()), deviceId: install }), env: DB });
    const out = (await res.json()) as { signed_device_id_next?: string };
    const expected = await idFromInstall(ENV.DEVICE_ID_SECRET, install);
    // The device row it WILL report as exists already, owned by the account…
    expect(fake.rows('listeners')).toEqual([expect.objectContaining({ id: expected, account_id: '110000000000000000001' })]);
    expect(fake.rows('accounts')[0].listener_id).toBe(expected);
    // …and the signed id it should echo from now on comes back.
    expect(out.signed_device_id_next).toBe(await signId(ENV.DEVICE_ID_SECRET, expected));
    // A malformed install id links nothing.
    const fake2 = fakeDb({}, googleKeys);
    await onRequestPost({ request: post({ credential: await token(good()), deviceId: 'x' }), env: DB });
    expect(fake2.rows('listeners')).toEqual([]);
  });

  it('V2 1.0.1 — the session check links each device that proves itself to the account', async () => {
    const LAPTOP = 'd_' + 'ab'.repeat(16);
    const fake = fakeDb({ accounts: [{ id: '42', email: 'e@x', email_verified: true, name: 'N', picture: null, listener_id: LISTENER, last_seen: new Date().toISOString() }], listeners: [{ id: LISTENER, account_id: '42' }, { id: LAPTOP }] });
    const me = await import('../functions/api/auth/me');
    const s = (await issueSession(DB, '42'))!;
    const headers = { authorization: `Bearer ${s}`, 'x-vinax-device': await signId(ENV.DEVICE_ID_SECRET, LAPTOP) };
    expect((await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers }), env: DB })).status).toBe(200);
    expect(fake.rows('listeners').find((l) => l.id === LAPTOP)?.account_id).toBe('42');
    expect(fake.rows('listeners').find((l) => l.id === LISTENER)?.account_id).toBe('42');
  });

  it('the session check answers the account, refreshes it, signs out when the row is gone, and delete removes the row', async () => {
    const fake = fakeDb({ accounts: [{ id: '42', email: 'e@x', email_verified: true, name: 'N', picture: null, listener_id: null, last_seen: '2026-01-01T00:00:00Z' }] });
    const me = await import('../functions/api/auth/me');
    const s = (await issueSession(DB, '42'))!;
    const r = await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: `Bearer ${s}`, 'cf-ipcountry': 'IN' } }), env: DB });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ user: { name: 'N', email: 'e@x', picture: null, username: null } });
    // The stale last_seen was refreshed (awaited: no waitUntil in the test).
    expect(fake.rows('accounts')[0].last_seen).not.toBe('2026-01-01T00:00:00Z');
    expect(fake.rows('accounts')[0].country).toBe('IN');
    const other = (await issueSession(DB, '43'))!;
    expect((await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: `Bearer ${other}` } }), env: DB })).status).toBe(401);
    const del = await me.onRequestPost({ request: new Request('https://example.test/api/auth/me', { method: 'POST', headers: { authorization: `Bearer ${s}`, 'content-type': 'application/json', 'cf-connecting-ip': '10.99.1.9' }, body: JSON.stringify({ delete: true }) }), env: DB });
    expect(await del.json()).toEqual({ ok: true });
    expect(fake.rows('accounts')).toHaveLength(0);
  });
});
