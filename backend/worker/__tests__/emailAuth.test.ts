/**
 * Schema 20 — email and password sign-in next to Google: a 6-digit email code
 * proves the address (sign-up, or a forgotten password), email + password signs
 * in, a Google listener can set a password in Settings, and a Google sign-in
 * with the address of an email account lands in that same account.
 *
 * bcrypt runs in the database; the fake database below stands in for the three
 * functions (account_set_password / account_check_password / account_has_password).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/googleAuth', async (orig) => {
  const real = await orig<typeof import('../functions/_lib/googleAuth')>();
  return {
    ...real,
    verifyGoogleIdToken: vi.fn(async (_env: unknown, token: unknown) => {
      if (token === 'google-asha') return { sub: '110000000000000000001', email: 'asha@example.com', emailVerified: true, name: 'Asha G', picture: null };
      if (token === 'google-new-ravi') return { sub: '110000000000000000002', email: 'Ravi@Example.com', emailVerified: true, name: 'Ravi G', picture: 'https://lh3.example/r.jpg' };
      if (token === 'google-unverified-ravi') return { sub: '110000000000000000003', email: 'ravi@example.com', emailVerified: false, name: 'Not Ravi', picture: null };
      return null;
    }),
  };
});

import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { normalEmail, passwordProblem } from '../functions/_lib/emailAuth';
import * as code from '../functions/api/auth/email/code';
import * as verify from '../functions/api/auth/email/verify';
import * as login from '../functions/api/auth/email/login';
import * as password from '../functions/api/auth/password';
import * as google from '../functions/api/auth/google';
import * as me from '../functions/api/auth/me';

const SECRETS = { AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com', RESEND_API_KEY: 're_test' };
const ENV = { ...SECRETS, ...DB_ENV };
const ASHA = '110000000000000000001';

const req = (path: string, body: unknown, session?: string) => new Request(`https://www.vinaxmusic.online${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(session ? { authorization: `Bearer ${session}` } : {}) },
  body: JSON.stringify(body),
});

/** The fake database, with the password functions, and every email Resend was asked to send. */
function setup(seed: Record<string, Array<Record<string, unknown>>> = {}): { fake: FakeDb; mails: Array<{ to: string[]; subject: string; text: string }> } {
  const mails: Array<{ to: string[]; subject: string; text: string }> = [];
  const fake = fakeDb(seed, (url, init) => {
    if (url.startsWith('https://api.resend.com/')) {
      mails.push(JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string });
      return new Response(JSON.stringify({ id: 'mail_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('ok');
  });
  const answer = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const pw = (): Array<Record<string, unknown>> => (fake.tables.account_passwords ??= []);
  fake.answer('rpc/account_set_password', (c) => {
    const { p_account, p_password } = c.body as { p_account: string; p_password: string };
    if (!fake.rows('accounts').some((a) => a.id === p_account)) return answer(false);
    const row = pw().find((r) => r.account_id === p_account);
    if (row) row.plain = p_password;
    else pw().push({ account_id: p_account, plain: p_password });
    return answer(true);
  });
  fake.answer('rpc/account_check_password', (c) => {
    const { p_email, p_password, p_account } = c.body as { p_email?: string; p_password: string; p_account?: string };
    const hit = fake.rows('accounts').find((a) =>
      (p_account ? a.id === p_account : String(a.email ?? '').toLowerCase() === String(p_email ?? '').toLowerCase())
      && pw().some((r) => r.account_id === a.id && r.plain === p_password));
    return answer(hit ? hit.id : null);
  });
  fake.answer('rpc/account_has_password', (c) => answer(pw().some((r) => r.account_id === (c.body as { p_account: string }).p_account)));
  return { fake, mails };
}

const codeIn = (mail: { text: string }): string => /\b(\d{6})\b/.exec(mail.text)![1];

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('email and password sign-in', () => {
  it('signs up with an emailed code, then signs in with the password', async () => {
    const { fake, mails } = setup();
    const sent = await code.onRequestPost({ request: req('/api/auth/email/code', { email: '  Ravi@Example.com ' }), env: ENV });
    expect(sent.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(['ravi@example.com']);
    expect(mails[0].subject).toMatch(/^\d{6} is your VinaX code$/);
    expect(mails[0].text).toContain('creating a VinaX account');
    // Only a hash of the code is stored.
    expect(JSON.stringify(fake.rows('email_codes'))).not.toContain(codeIn(mails[0]));

    const later: Promise<unknown>[] = [];
    const res = await verify.onRequestPost({ request: req('/api/auth/email/verify', { email: 'ravi@example.com', code: codeIn(mails[0]), password: 'tabla-rhythm-9', name: 'Ravi' }), env: ENV, waitUntil: (p) => later.push(p) });
    expect(res.status).toBe(200);
    await Promise.all(later);
    const out = (await res.json()) as { session: string; returning: boolean; method: string; user: { name: string; email: string; hasPassword: boolean } };
    expect(out.session).toMatch(/^vx1\./);
    expect(out).toMatchObject({ returning: false, method: 'email', user: { name: 'Ravi', email: 'ravi@example.com', hasPassword: true } });
    const [acct] = fake.rows('accounts');
    expect(acct.id).toMatch(/^em[a-f0-9]{24}$/);
    expect(acct).toMatchObject({ email: 'ravi@example.com', email_verified: true });
    expect(fake.rows('email_codes')).toHaveLength(0);
    expect(fake.rows('sign_ins')[0]).toMatchObject({ account_id: acct.id, signup: true });
    expect(mails.map((m) => m.subject)).toContain('Welcome to VinaX');

    const bad = await login.onRequestPost({ request: req('/api/auth/email/login', { email: 'ravi@example.com', password: 'wrong-password' }), env: ENV });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'wrong_password' });
    const good = await login.onRequestPost({ request: req('/api/auth/email/login', { email: 'RAVI@example.com', password: 'tabla-rhythm-9' }), env: ENV });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ returning: true, method: 'password', user: { email: 'ravi@example.com', hasPassword: true } });
    // The session works for /api/auth/me like a Google one.
    const check = await me.onRequestGet({ request: new Request('https://x/api/auth/me', { headers: { authorization: `Bearer ${out.session}` } }), env: ENV });
    expect(await check.json()).toMatchObject({ user: { email: 'ravi@example.com', hasPassword: true } });
  });

  it('a second code waits a minute; a wrong code counts down and five wrong tries end it', async () => {
    const { mails } = setup();
    await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'mira@example.com' }), env: ENV });
    const again = await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'mira@example.com' }), env: ENV });
    expect(again.status).toBe(429);
    expect(((await again.json()) as { error: string; retryIn: number })).toMatchObject({ error: 'wait' });
    expect(mails).toHaveLength(1);
    const right = codeIn(mails[0]);
    const wrong = right === '000000' ? '111111' : '000000';
    const attempt = () => verify.onRequestPost({ request: req('/api/auth/email/verify', { email: 'mira@example.com', code: wrong, password: 'long-enough-1' }), env: ENV });
    for (let left = 4; left >= 1; left--) expect(await (await attempt()).json()).toEqual({ error: 'wrong_code', triesLeft: left });
    expect(await (await attempt()).json()).toEqual({ error: 'code_expired' });
    // Even the right code is gone now.
    const late = await verify.onRequestPost({ request: req('/api/auth/email/verify', { email: 'mira@example.com', code: right, password: 'long-enough-1' }), env: ENV });
    expect(await late.json()).toEqual({ error: 'code_expired' });
  });

  it('a code for an address with a Google account sets that account’s password (no second account)', async () => {
    const { fake, mails } = setup({ accounts: [{ id: ASHA, email: 'asha@example.com', email_verified: true, name: 'Asha G', picture: null, created_at: '2026-01-01T00:00:00Z', last_seen: '2026-01-01T00:00:00Z' }] });
    await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'asha@example.com' }), env: ENV });
    expect(mails[0].text).toContain('set a new password');
    const res = await verify.onRequestPost({ request: req('/api/auth/email/verify', { email: 'asha@example.com', code: codeIn(mails[0]), password: 'sitar-strings', name: 'Someone Else' }), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ returning: true, user: { name: 'Asha G', hasPassword: true } });
    expect(fake.rows('accounts')).toHaveLength(1);
    const good = await login.onRequestPost({ request: req('/api/auth/email/login', { email: 'asha@example.com', password: 'sitar-strings' }), env: ENV });
    expect(good.status).toBe(200);
  });

  it('a Google sign-in with an email account’s verified address lands in that account', async () => {
    const { fake, mails } = setup();
    await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'ravi@example.com' }), env: ENV });
    await verify.onRequestPost({ request: req('/api/auth/email/verify', { email: 'ravi@example.com', code: codeIn(mails[0]), password: 'tabla-rhythm-9', name: 'Ravi' }), env: ENV });
    const emailId = fake.rows('accounts')[0].id as string;

    const viaGoogle = await google.onRequestPost({ request: req('/api/auth/google', { credential: 'google-new-ravi' }), env: ENV });
    expect(viaGoogle.status).toBe(200);
    expect(await viaGoogle.json()).toMatchObject({ returning: true, method: 'google', user: { name: 'Ravi G', hasPassword: true } });
    expect(fake.rows('accounts')).toHaveLength(1);
    expect(fake.rows('accounts')[0]).toMatchObject({ id: emailId, picture: 'https://lh3.example/r.jpg' });

    // An address Google did not verify gets its own account, never this one.
    await google.onRequestPost({ request: req('/api/auth/google', { credential: 'google-unverified-ravi' }), env: ENV });
    expect(fake.rows('accounts').map((a) => a.id)).toEqual([emailId, '110000000000000000003']);
  });

  it('Settings: a Google listener sets a first password, and changing it needs the old one', async () => {
    const { fake } = setup({ accounts: [{ id: ASHA, email: 'asha@example.com', email_verified: true, name: 'Asha G', picture: null, created_at: '2026-01-01T00:00:00Z', last_seen: '2026-01-01T00:00:00Z' }] });
    const session = (await issueSession(ENV, ASHA))!;
    const get = () => password.onRequestGet({ request: new Request('https://x/api/auth/password', { headers: { authorization: `Bearer ${session}` } }), env: ENV });
    expect(await (await get()).json()).toEqual({ hasPassword: false });

    const short = await password.onRequestPost({ request: req('/api/auth/password', { password: 'short' }, session), env: ENV });
    expect(await short.json()).toEqual({ error: 'password_short' });
    const first = await password.onRequestPost({ request: req('/api/auth/password', { password: 'veena-melody' }, session), env: ENV });
    expect(await first.json()).toEqual({ ok: true });
    expect(await (await get()).json()).toEqual({ hasPassword: true });

    const noOld = await password.onRequestPost({ request: req('/api/auth/password', { password: 'new-one-please' }, session), env: ENV });
    expect(noOld.status).toBe(403);
    const wrongOld = await password.onRequestPost({ request: req('/api/auth/password', { password: 'new-one-please', current: 'nope-nope' }, session), env: ENV });
    expect(wrongOld.status).toBe(403);
    const changed = await password.onRequestPost({ request: req('/api/auth/password', { password: 'new-one-please', current: 'veena-melody' }, session), env: ENV });
    expect(await changed.json()).toEqual({ ok: true });
    expect(fake.rows('account_passwords')).toEqual([{ account_id: ASHA, plain: 'new-one-please' }]);

    _resetRateLimitsForTests();
    const anon = await password.onRequestPost({ request: req('/api/auth/password', { password: 'veena-melody' }), env: ENV });
    expect(anon.status).toBe(401);
  });

  it('refuses bad addresses and passwords, and is off without a database or Resend', async () => {
    setup();
    expect(normalEmail('a@b')).toBeNull();
    expect(normalEmail('x y@example.com')).toBeNull();
    expect(normalEmail('A.B+c@Mail.Example.co.in')).toBe('a.b+c@mail.example.co.in');
    expect(passwordProblem('1234567')).toBe('short');
    expect(passwordProblem('é'.repeat(40))).toBe('long');
    expect(passwordProblem('12345678')).toBeNull();
    const bad = await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'nope' }), env: ENV });
    expect(await bad.json()).toEqual({ error: 'bad_email' });
    const noResend = await code.onRequestPost({ request: req('/api/auth/email/code', { email: 'a@example.com' }), env: { ...ENV, RESEND_API_KEY: '' } });
    expect(noResend.status).toBe(503);
    const noDb = await login.onRequestPost({ request: req('/api/auth/email/login', { email: 'a@example.com', password: '12345678' }), env: SECRETS });
    expect(noDb.status).toBe(503);
  });
});
