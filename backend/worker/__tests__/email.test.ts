/**
 * Account emails through Resend: the client (request shape, failures), the
 * `email` setting, and when each email goes out — welcome on a first
 * sign-in, an alert on a new device (never on a known one), console sign-in
 * alerts (the recovery password tells every owner), the admin invite, and the
 * console's test button. Resend is never really called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/googleAuth', async (orig) => {
  const real = await orig<typeof import('../functions/_lib/googleAuth')>();
  return {
    ...real,
    verifyGoogleIdToken: vi.fn(async (_env: unknown, token: unknown) => {
      if (token === 'listener-token') return { sub: '110000000000000000001', email: 'listener@example.com', emailVerified: true, name: 'Asha <b>Rao</b>', picture: null };
      if (token === 'unverified-token') return { sub: '110000000000000000002', email: 'u@example.com', emailVerified: false, name: null, picture: null };
      if (token === 'boss-token') return { sub: '7', email: 'boss@example.com', emailVerified: true, name: 'Boss', picture: null };
      return null;
    }),
  };
});

import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { describeAgent, emailSettingsOf, escapeHtml, newSignInEmail, placeOf, RESEND_URL, sendEmail, sendLater, welcomeEmail } from '../functions/_lib/email';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { signId } from '../functions/_lib/identity';
import * as google from '../functions/api/auth/google';
import * as session from '../functions/api/admin/session';
import * as admins from '../functions/api/admin/admins';
import * as emailRoute from '../functions/api/admin/email';

const SECRETS = { AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com' };
const KEY = { RESEND_API_KEY: 're_test_key' };
const ENV = { ...SECRETS, ...DB_ENV, ...KEY };

interface Sent { headers: Record<string, string>; body: Record<string, unknown> }
let sent: Sent[] = [];
let resendAnswer: () => Response = () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
/** The fake database's fallback: Resend calls are recorded, everything else 404s. */
const outside = (url: string, init?: RequestInit): Response => {
  if (url === RESEND_URL) {
    sent.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return resendAnswer();
  }
  return new Response('{}', { status: 404 });
};

/** A waitUntil that the test can drain. */
function later() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, drain: () => Promise.all(pending) };
}

beforeEach(() => {
  sent = [];
  resendAnswer = () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
  resetSettingsMemo();
  resetAdminMemo();
  _resetRateLimitsForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('the Resend client', () => {
  it('posts one email with the key, the default sender and reply address, a kind tag and the idempotency key', async () => {
    fakeDb({}, outside);
    const r = await sendEmail(KEY, { ...welcomeEmail('a@example.com', 'Asha'), idempotencyKey: 'welcome/1' });
    expect(r).toEqual({ ok: true, id: 'em_1' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers).toMatchObject({ authorization: 'Bearer re_test_key', 'idempotency-key': 'welcome/1' });
    expect(sent[0]!.body).toMatchObject({ from: 'VinaX <notifications@vinaxmusic.online>', to: ['a@example.com'], reply_to: 'support@vinaxmusic.online', subject: 'Welcome to VinaX', tags: [{ name: 'kind', value: 'welcome' }] });
    expect(String(sent[0]!.body.text)).toContain('Welcome, Asha!');
  });

  it('uses EMAIL_FROM and EMAIL_REPLY_TO when set', async () => {
    fakeDb({}, outside);
    await sendEmail({ ...KEY, EMAIL_FROM: 'VinaX <no-reply@mail.vinaxmusic.online>', EMAIL_REPLY_TO: 'help@vinaxmusic.online' }, welcomeEmail('a@example.com', null));
    expect(sent[0]!.body).toMatchObject({ from: 'VinaX <no-reply@mail.vinaxmusic.online>', reply_to: 'help@vinaxmusic.online' });
  });

  it('answers a failure, never throws: no key, a refusal, the network', async () => {
    fakeDb({}, outside);
    expect(await sendEmail({}, welcomeEmail('a@example.com', null))).toMatchObject({ ok: false, error: 'not_configured' });
    expect(sent).toHaveLength(0);
    resendAnswer = () => new Response(JSON.stringify({ statusCode: 403, name: 'validation_error', message: 'The domain is not verified' }), { status: 403 });
    expect(await sendEmail(KEY, welcomeEmail('a@example.com', null))).toEqual({ ok: false, error: 'validation_error', status: 403 });
    resendAnswer = () => { throw new Error('offline'); };
    expect(await sendEmail(KEY, welcomeEmail('a@example.com', null))).toMatchObject({ ok: false, error: 'network' });
  });

  it('a template that throws costs the email, not the caller', async () => {
    fakeDb({}, outside);
    const r = await sendLater(ENV, undefined, 'welcome', () => { throw new Error('broken'); });
    expect(r).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe('the email setting and templates', () => {
  it('everything is on unless switched off', () => {
    expect(emailSettingsOf(null)).toEqual({ enabled: true, welcome: true, newSignIn: true, consoleSignIn: true, adminInvite: true });
    expect(emailSettingsOf({ welcome: false, newSignIn: 0 })).toMatchObject({ welcome: false, newSignIn: true });
    expect(emailSettingsOf([false])).toMatchObject({ enabled: true });
  });

  it('a switched-off kind, or the master switch, sends nothing', async () => {
    fakeDb({ settings: [{ key: 'email', value: { welcome: false }, updated_at: 't', updated_by: 'boss' }] }, outside);
    expect(await sendLater(ENV, undefined, 'welcome', () => welcomeEmail('a@example.com', null))).toBeNull();
    expect(await sendLater(ENV, undefined, 'newSignIn', () => welcomeEmail('a@example.com', null))).toMatchObject({ ok: true });
    resetSettingsMemo();
    fakeDb({ settings: [{ key: 'email', value: { enabled: false }, updated_at: 't', updated_by: 'boss' }] }, outside);
    sent = [];
    expect(await sendLater(ENV, undefined, 'newSignIn', () => welcomeEmail('a@example.com', null))).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('escapes what people typed, and says where and on what', () => {
    const e = newSignInEmail('a@example.com', '<script>x</script>', { platform: 'android', city: 'Hyderabad', region: 'Telangana', country: 'IN', timezone: 'Asia/Kolkata', at: new Date('2026-11-06T10:00:00Z') });
    expect(e.html).not.toContain('<script>x');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('Device: the VinaX Android app');
    expect(e.text).toContain('Near: Hyderabad, Telangana, India (approximate)');
    expect(e.text).toMatch(/When: 6 Nov 2026, 3:30\s?pm IST/i);
    expect(placeOf({ city: null, region: null, country: null })).toBeNull();
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('names the browser and system from the user agent', () => {
    expect(describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome on macOS');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge on Windows');
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(describeAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36')).toBe('the VinaX Android app (Android 14)');
    expect(describeAgent('Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36')).toBe('Samsung Internet on Android 13');
    expect(describeAgent('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Linux');
    expect(describeAgent('curl/8.0')).toBeNull();
    expect(describeAgent(null)).toBeNull();
  });
});

describe('the app sign-in sends', () => {
  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const post = (body: unknown) => new Request('https://www.vinaxmusic.online/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.99.2.1', 'cf-ipcountry': 'IN', 'user-agent': CHROME_MAC }, body: JSON.stringify(body) });
  const PHONE = 'd_' + 'ef'.repeat(16);
  const LAPTOP = 'd_' + 'ab'.repeat(16);

  it('a welcome on the first sign-in, then a sign-in alert on every later one', async () => {
    fakeDb({}, outside);
    const w = later();
    expect((await google.onRequestPost({ request: post({ credential: 'listener-token' }), env: ENV, waitUntil: w.waitUntil })).status).toBe(200);
    await w.drain();
    expect(sent.map((s) => s.body.subject)).toEqual(['Welcome to VinaX']);
    expect(sent[0]!.headers['idempotency-key']).toBe('welcome/110000000000000000001');
    expect(sent[0]!.body.html).toContain('Welcome, Asha!');
    expect(String(sent[0]!.body.text)).toContain('You signed up from:');
    expect(String(sent[0]!.body.text)).toContain('IP address: 10.99.2.1');
    // Signing out and in again on the same browser: a sign-in alert (not a second welcome).
    const w2 = later();
    await google.onRequestPost({ request: post({ credential: 'listener-token' }), env: ENV, waitUntil: w2.waitUntil });
    await w2.drain();
    expect(sent.map((s) => s.body.subject)).toEqual(['Welcome to VinaX', 'New sign-in to your VinaX account']);
    expect(String(sent[1]!.body.text)).toContain('Device: Chrome on macOS');
    expect(String(sent[1]!.body.text)).toContain('IP address: 10.99.2.1');
    expect(String(sent[1]!.body.text)).toContain('Near: India (approximate)');
    expect(sent[1]!.headers['idempotency-key']).toMatch(/^signin\/110000000000000000001\/unknown\/\d+$/);
  });

  it('an alert on every sign-in, and a new device is called out', async () => {
    const fake = fakeDb({
      accounts: [{ id: '110000000000000000001', email: 'listener@example.com', email_verified: true, name: 'Asha', picture: null, listener_id: PHONE, last_seen: 't' }],
      listeners: [{ id: PHONE, account_id: '110000000000000000001' }, { id: LAPTOP }],
    }, outside);
    // The known phone: a plain sign-in alert.
    let w = later();
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, PHONE) }), env: ENV, waitUntil: w.waitUntil });
    await w.drain();
    expect(sent.map((s) => s.body.subject)).toEqual(['New sign-in to your VinaX account']);
    expect(sent[0]!.body.to).toEqual(['listener@example.com']);
    expect(String(sent[0]!.body.text)).not.toContain("hasn't used before");
    // A new laptop: the alert says it is a new device, then the laptop is linked.
    w = later();
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, LAPTOP), platform: 'web' }), env: ENV, waitUntil: w.waitUntil });
    await w.drain();
    expect(sent[1]!.body.subject).toBe('New device signed in to your VinaX account');
    expect(String(sent[1]!.body.text)).toContain("on a device it hasn't used before");
    expect(sent[1]!.headers['idempotency-key']).toMatch(new RegExp(`^signin/110000000000000000001/${LAPTOP}/\\d+$`));
    expect(fake.rows('listeners').find((l) => l.id === LAPTOP)?.account_id).toBe('110000000000000000001');
    // The laptop again: a plain alert.
    w = later();
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, LAPTOP) }), env: ENV, waitUntil: w.waitUntil });
    await w.drain();
    expect(sent[2]!.body.subject).toBe('New sign-in to your VinaX account');
  });

  it('nothing without the Resend key, or for an unverified email', async () => {
    fakeDb({}, outside);
    const w = later();
    const noKey: Record<string, unknown> = { ...ENV }; delete noKey.RESEND_API_KEY;
    expect((await google.onRequestPost({ request: post({ credential: 'listener-token' }), env: noKey, waitUntil: w.waitUntil })).status).toBe(200);
    await google.onRequestPost({ request: post({ credential: 'unverified-token' }), env: ENV, waitUntil: w.waitUntil });
    await w.drain();
    expect(sent).toHaveLength(0);
  });
});

describe('the console sends', () => {
  const ADMINS = () => [
    { email: 'boss@example.com', role: 'owner', name: 'Boss', picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    { email: 'second@example.com', role: 'owner', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    { email: 'viewer@example.com', role: 'viewer', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
  ];
  const CONSOLE_ENV = { ...ENV, ADMIN_LOGIN_PASSWORD: 'owner-pass' };
  const req = (path: string, body?: unknown, token?: string) => new Request(`https://admin.vinaxmusic.online${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.50', ...(token ? { 'x-admin-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  it('an alert to the admin who signed in with Google', async () => {
    fakeDb({ admins: ADMINS() }, outside);
    const w = later();
    expect((await session.onRequestPost({ request: req('/api/admin/session', { credential: 'boss-token' }), env: CONSOLE_ENV, waitUntil: w.waitUntil })).status).toBe(200);
    await w.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ to: ['boss@example.com'], subject: 'VinaX console sign-in' });
  });

  it('the recovery password tells every owner', async () => {
    fakeDb({ admins: ADMINS() }, outside);
    const w = later();
    expect((await session.onRequestPost({ request: req('/api/admin/session', { password: 'owner-pass' }), env: CONSOLE_ENV, waitUntil: w.waitUntil })).status).toBe(200);
    await w.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ subject: 'VinaX console: recovery password used' });
    expect((sent[0]!.body.to as string[]).sort()).toEqual(['boss@example.com', 'second@example.com']);
  });

  it('an invite email, and the answer says it went', async () => {
    fakeDb({ admins: ADMINS() }, outside);
    const token = (await issueAdminSession(CONSOLE_ENV, 'boss@example.com'))!;
    const res = await admins.onRequestPost({ request: req('/api/admin/admins', { action: 'invite', email: 'New@Example.com', role: 'editor' }, token), env: CONSOLE_ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    expect(sent[0]!.body).toMatchObject({ to: ['new@example.com'], subject: 'You have been added to the VinaX console' });
    expect(String(sent[0]!.body.text)).toContain('boss@example.com added you to the VinaX owner console as editor');
  });

  it('GET says whether email is set up; the test button is for owners and reports Resend refusals', async () => {
    fakeDb({ admins: ADMINS() }, outside);
    const boss = (await issueAdminSession(CONSOLE_ENV, 'boss@example.com'))!;
    const viewer = (await issueAdminSession(CONSOLE_ENV, 'viewer@example.com'))!;
    const get = await emailRoute.onRequestGet({ request: req('/api/admin/email', undefined, viewer), env: CONSOLE_ENV });
    expect(await get.json()).toMatchObject({ configured: true, from: 'VinaX <notifications@vinaxmusic.online>', settings: { enabled: true } });
    expect((await emailRoute.onRequestPost({ request: req('/api/admin/email', { action: 'test' }, viewer), env: CONSOLE_ENV })).status).toBe(403);
    const ok = await emailRoute.onRequestPost({ request: req('/api/admin/email', { action: 'test' }, boss), env: CONSOLE_ENV });
    expect(ok.status).toBe(200);
    expect(sent[0]!.body).toMatchObject({ to: ['boss@example.com'], subject: 'VinaX test email' });
    resendAnswer = () => new Response(JSON.stringify({ name: 'validation_error', message: 'domain not verified' }), { status: 403 });
    const bad = await emailRoute.onRequestPost({ request: req('/api/admin/email', { action: 'test' }, boss), env: CONSOLE_ENV });
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ error: 'validation_error' });
    const noKey: Record<string, unknown> = { ...CONSOLE_ENV }; delete noKey.RESEND_API_KEY;
    expect((await emailRoute.onRequestPost({ request: req('/api/admin/email', { action: 'test' }, boss), env: noKey })).status).toBe(503);
  });
});
