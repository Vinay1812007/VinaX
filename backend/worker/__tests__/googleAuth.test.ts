/**
 * 12.2 — Google sign-in: ID tokens are checked against Google's keys (here a
 * key pair made in the test, served by a mocked key endpoint), sessions are
 * signed and expire, and the routes link a username only for a device that
 * proves it owns it. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSession, readSession, resetGoogleKeys, verifyGoogleIdToken } from '../functions/_lib/googleAuth';

const CLIENT = '152181244509-test.apps.googleusercontent.com';
const ENV = { GOOGLE_CLIENT_ID: CLIENT, AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests' };
const DB = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

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
function stub(db: { username?: string | null } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null; } catch { /* not JSON */ }
    calls.push({ url, method, body });
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
    if (url.includes('/rest/v1/vinax_accounts') && method === 'GET') return new Response('[]', { status: 200 });
    if (url.includes('/rest/v1/vinax_users') && method === 'GET') return new Response(JSON.stringify(db.username !== undefined ? [{ username: db.username }] : []), { status: 200 });
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

  it('signs in, stores the account, and links the username only for a device that proves it owns it', async () => {
    const { onRequestPost } = await import('../functions/api/auth/google');
    let calls = stub({ username: 'vinay' });
    let res = await onRequestPost({ request: post({ credential: await token(good()), signed_device_id: 'forged.value' }), env: { ...ENV, ...DB } });
    expect(res.status).toBe(200);
    let out = (await res.json()) as { session: string; stored: boolean; user: { username: string | null; email: string } };
    expect(out.user).toMatchObject({ email: 'listener@example.com', username: null });
    expect(out.stored).toBe(true);
    expect(calls.some((c) => c.url.includes('vinax_users'))).toBe(false);
    const row = calls.find((c) => c.url.includes('/rest/v1/vinax_accounts') && c.method === 'POST')?.body;
    expect(row).toMatchObject({ google_sub: '110000000000000000001', email: 'listener@example.com', email_verified: true, username: null });
    // A real signed device id links the device's username.
    const { resolveIdentity } = await import('../functions/_lib/identity');
    const minted = await resolveIdentity(new Request('https://x.test'), ENV, { deviceId: 'install-abcdef123456' });
    calls = stub({ username: 'vinay' });
    res = await onRequestPost({ request: post({ credential: await token(good()), signed_device_id: minted.issued }), env: { ...ENV, ...DB } });
    out = (await res.json()) as typeof out;
    expect(out.user.username).toBe('vinay');
    expect(calls.some((c) => c.url.includes('vinax_users'))).toBe(true);
    // The session opens /api/auth/me.
    const me = await import('../functions/api/auth/me');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ google_sub: '110000000000000000001', email: 'listener@example.com', name: 'A Listener', picture: null, username: 'vinay' }]), { status: 200 })));
    const r = await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: `Bearer ${out.session}` } }), env: { ...ENV, ...DB } });
    expect(await r.json()).toEqual({ user: { name: 'A Listener', email: 'listener@example.com', picture: null, username: 'vinay' } });
    const no = await me.onRequestGet({ request: new Request('https://example.test/api/auth/me', { headers: { authorization: 'Bearer vx1.bad.sig' } }), env: { ...ENV, ...DB } });
    expect(no.status).toBe(401);
  });

  it('a bad token is 401; no client id is 503; the key never reaches the reply', async () => {
    const { onRequestPost } = await import('../functions/api/auth/google');
    stub();
    expect((await onRequestPost({ request: post({ credential: 'nope' }), env: { ...ENV, ...DB } })).status).toBe(401);
    expect((await onRequestPost({ request: post({ credential: await token(good()) }), env: { ...DB, AUTH_SECRET: 'x' } })).status).toBe(503);
    const ok = await onRequestPost({ request: post({ credential: await token(good()) }), env: { ...ENV, ...DB } });
    expect(await ok.text()).not.toContain('auth-secret-for-tests');
  });

  it('deleting the account removes the row', async () => {
    const { issueSession: issue } = await import('../functions/_lib/googleAuth');
    const me = await import('../functions/api/auth/me');
    const calls = stub();
    const s = await issue(ENV, '110000000000000000001');
    const res = await me.onRequestPost({ request: new Request('https://example.test/api/auth/me', { method: 'POST', headers: { authorization: `Bearer ${s}`, 'content-type': 'application/json', 'cf-connecting-ip': '10.99.0.2' }, body: JSON.stringify({ delete: true }) }), env: { ...ENV, ...DB } });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('vinax_accounts?google_sub=eq.110000000000000000001'))).toBe(true);
  });
});
