/**
 * Cloudflare Turnstile on sign-in: the Siteverify check (on only with both
 * keys; action and hostname must match), the app's Google sign-in, and the
 * console's Google and recovery-password sign-in (the password is traded
 * for a session and stops working as a key while Turnstile is on).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/googleAuth', async (orig) => {
  const real = await orig<typeof import('../functions/_lib/googleAuth')>();
  return { ...real, verifyGoogleIdToken: vi.fn(async (_env: unknown, token: unknown) => (token === 'good-google-token' ? { sub: '123', email: 'boss@example.com', emailVerified: true, name: 'Boss', picture: null } : null)) };
});

import { turnstileSiteKey, verifyTurnstile } from '../functions/_lib/turnstile';
import { adminPrincipal } from '../functions/_lib/admin';
import { resetAdminMemo } from '../functions/_lib/adminAuth';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import * as session from '../functions/api/admin/session';
import * as appSignIn from '../functions/api/auth/google';

const KEYS = { TURNSTILE_SITE_KEY: '0x4AAAAAAA-site', TURNSTILE_SECRET_KEY: '0x4AAAAAAA-secret' };
const ENV = { ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'auth-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com', ADMIN_OWNER_EMAILS: 'boss@example.com' };
const ON = { ...ENV, ...KEYS };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
let verified: Array<{ response: string; remoteip: string | null; secret: string }> = [];
let siteverifyDown = false;

/** Siteverify answers by token: "pass-app", "pass-console", "pass-elsewhere" (another site); anything else fails. */
function stub(): void {
  verified = [];
  siteverifyDown = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      if (siteverifyDown) throw new TypeError('network');
      const form = init?.body as FormData;
      const response = String(form.get('response'));
      verified.push({ response, remoteip: form.get('remoteip') as string | null, secret: String(form.get('secret')) });
      if (response === 'pass-app') return json({ success: true, action: 'app-signin', hostname: 'vinaxmusic.online' });
      if (response === 'pass-console') return json({ success: true, action: 'console-signin', hostname: 'admin.vinaxmusic.online' });
      if (response === 'pass-elsewhere') return json({ success: true, action: 'console-signin', hostname: 'evil.example' });
      return json({ success: false, 'error-codes': ['invalid-input-response'] });
    }
    return json([]);
  }));
}
const req = (path: string, body?: unknown, token?: string) => new Request(`https://admin.vinaxmusic.online${path}`, {
  method: body !== undefined ? 'POST' : 'GET',
  headers: { 'cf-connecting-ip': '203.0.113.30', ...(token ? { 'x-admin-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const call = async (h: unknown, r: Request, env: Record<string, unknown>) => {
  const res = await (h as H)({ request: r, env });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeEach(() => { resetAdminMemo(); _resetRateLimitsForTests(); stub(); });
afterEach(() => vi.unstubAllGlobals());

describe('the Siteverify check', () => {
  it('is off until both keys are set, and then names the site key', async () => {
    expect(turnstileSiteKey({})).toBeNull();
    expect(turnstileSiteKey({ TURNSTILE_SITE_KEY: 'x' })).toBeNull();
    expect(turnstileSiteKey({ TURNSTILE_SECRET_KEY: 'y' })).toBeNull();
    expect(turnstileSiteKey(KEYS)).toBe('0x4AAAAAAA-site');
    expect(await verifyTurnstile({}, undefined, req('/'), 'app-signin')).toBe('ok');
    expect(verified).toHaveLength(0);
  });

  it('passes a good token for the right action and our site, and sends the visitor IP', async () => {
    expect(await verifyTurnstile(KEYS, 'pass-app', req('/'), 'app-signin')).toBe('ok');
    expect(verified[0]).toEqual({ response: 'pass-app', remoteip: '203.0.113.30', secret: '0x4AAAAAAA-secret' });
  });

  it('refuses a missing, bad, other-action or other-site token; says when Cloudflare is unreachable', async () => {
    expect(await verifyTurnstile(KEYS, undefined, req('/'), 'app-signin')).toBe('missing');
    expect(await verifyTurnstile(KEYS, 'x'.repeat(3000), req('/'), 'app-signin')).toBe('missing');
    expect(await verifyTurnstile(KEYS, 'nope', req('/'), 'app-signin')).toBe('failed');
    expect(await verifyTurnstile(KEYS, 'pass-console', req('/'), 'app-signin')).toBe('failed');
    expect(await verifyTurnstile(KEYS, 'pass-elsewhere', req('/'), 'console-signin')).toBe('failed');
    siteverifyDown = true;
    expect(await verifyTurnstile(KEYS, 'pass-app', req('/'), 'app-signin')).toBe('unavailable');
  });
});

describe("the app's Google sign-in", () => {
  it('GET names the site key (null when off)', async () => {
    expect((await call(appSignIn.onRequestGet, req('/api/auth/google'), ENV)).body).toEqual({ turnstileSiteKey: null });
    expect((await call(appSignIn.onRequestGet, req('/api/auth/google'), ON)).body).toEqual({ turnstileSiteKey: '0x4AAAAAAA-site' });
  });

  it('with Turnstile on, refuses a sign-in without a passed check before looking at the Google token', async () => {
    const none = await call(appSignIn.onRequestPost, req('/api/auth/google', { credential: 'good-google-token' }), ON);
    expect(none).toEqual({ status: 403, body: { error: 'human_check' } });
    const wrongAction = await call(appSignIn.onRequestPost, req('/api/auth/google', { credential: 'good-google-token', turnstile: 'pass-console' }), ON);
    expect(wrongAction.status).toBe(403);
    const ok = await call(appSignIn.onRequestPost, req('/api/auth/google', { credential: 'good-google-token', turnstile: 'pass-app' }), ON);
    expect(ok.status).toBe(200);
    expect(typeof ok.body?.session).toBe('string');
  });

  it('with Turnstile off, or Cloudflare unreachable, the Google token alone signs in', async () => {
    expect((await call(appSignIn.onRequestPost, req('/api/auth/google', { credential: 'good-google-token' }), ENV)).status).toBe(200);
    siteverifyDown = true;
    expect((await call(appSignIn.onRequestPost, req('/api/auth/google', { credential: 'good-google-token', turnstile: 'pass-app' }), ON)).status).toBe(200);
  });
});

describe("the console's sign-in", () => {
  it('GET names the site key', async () => {
    expect((await call(session.onRequestGet, req('/api/admin/session'), ON)).body?.turnstileSiteKey).toBe('0x4AAAAAAA-site');
    expect((await call(session.onRequestGet, req('/api/admin/session'), ENV)).body?.turnstileSiteKey).toBeNull();
  });

  it('Google sign-in needs a passed check when Turnstile is on', async () => {
    expect((await call(session.onRequestPost, req('/api/admin/session', { credential: 'good-google-token' }), ON)).body).toEqual({ error: 'human_check' });
    const ok = await call(session.onRequestPost, req('/api/admin/session', { credential: 'good-google-token', turnstile: 'pass-console' }), ON);
    expect(ok.status).toBe(200);
    expect(ok.body?.me).toMatchObject({ email: 'boss@example.com', role: 'owner', via: 'google' });
  });

  it('the recovery password is traded for a session after the check; it is no longer a key by itself', async () => {
    // The password as a key: refused while Turnstile is on, fine while it is off.
    expect(await adminPrincipal(req('/api/admin/overview', undefined, 'owner-pass'), ON)).toBeNull();
    expect((await adminPrincipal(req('/api/admin/overview', undefined, 'owner-pass'), ENV))?.via).toBe('password');

    expect((await call(session.onRequestPost, req('/api/admin/session', { password: 'owner-pass' }), ON)).body).toEqual({ error: 'human_check' });
    expect((await call(session.onRequestPost, req('/api/admin/session', { password: 'wrong', turnstile: 'pass-console' }), ON))).toEqual({ status: 401, body: { error: 'wrong_password' } });
    const ok = await call(session.onRequestPost, req('/api/admin/session', { password: 'owner-pass', turnstile: 'pass-console' }), ON);
    expect(ok.status).toBe(200);
    expect(ok.body?.me).toMatchObject({ email: 'owner', role: 'owner', via: 'password' });
    const token = String(ok.body?.token);
    expect(token.startsWith('adm1.')).toBe(true);
    expect(await adminPrincipal(req('/api/admin/overview', undefined, token), ON)).toMatchObject({ email: 'owner', via: 'password' });
    // Changing or removing the password ends its sessions.
    expect(await adminPrincipal(req('/api/admin/overview', undefined, token), { ...ON, ADMIN_LOGIN_PASSWORD: 'new-pass' })).toBeNull();
    expect(await adminPrincipal(req('/api/admin/overview', undefined, token), { ...ON, ADMIN_LOGIN_PASSWORD: undefined })).toBeNull();
  });

  it('the password is refused when Cloudflare cannot be reached, and when it is turned off', async () => {
    siteverifyDown = true;
    expect((await call(session.onRequestPost, req('/api/admin/session', { password: 'owner-pass', turnstile: 'pass-console' }), ON))).toEqual({ status: 503, body: { error: 'human_check_unavailable' } });
    expect((await call(session.onRequestPost, req('/api/admin/session', { password: 'owner-pass' }), { ...ON, ADMIN_LOGIN_PASSWORD: undefined })).status).toBe(403);
  });

  it('with Turnstile off the password route works without a check', async () => {
    const ok = await call(session.onRequestPost, req('/api/admin/session', { password: 'owner-pass' }), ENV);
    expect(ok.status).toBe(200);
    expect(verified).toHaveLength(0);
  });
});
