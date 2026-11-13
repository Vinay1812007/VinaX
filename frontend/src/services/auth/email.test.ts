// @vitest-environment jsdom
/** Schema 20 — email and password sign-in: the code request, the code + password
 *  step, the password sign-in and the Settings password call, and the line
 *  each failure shows. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { setLocal } from '@/services/storage/local';
import { currentAccount, resetSessionCheckForTests, signOut } from './google';
import { emailAuthMessage, requestEmailCode, setPassword, signInWithPassword, verifyEmailCode } from './email';

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const noCheck = async () => undefined;
const USER = { name: 'Ravi', email: 'ravi@example.com', picture: null, username: null, hasPassword: true };

beforeEach(() => {
  localStorage.clear();
  resetSessionCheckForTests();
});
afterEach(() => {
  signOut();
  vi.restoreAllMocks();
});

describe('email sign-in', () => {
  it('asks for a code and names the wait', async () => {
    const f = reply({ ok: true });
    expect(await requestEmailCode('ravi@example.com', f, noCheck)).toEqual({ result: 'ok' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/email/code');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ravi@example.com' });
    const wait = await requestEmailCode('ravi@example.com', reply({ error: 'wait', retryIn: 42 }, 429), noCheck);
    expect(wait).toEqual({ result: 'wait', retryIn: 42, triesLeft: undefined });
    expect(emailAuthMessage(wait)).toContain('42 s');
    expect(await requestEmailCode('x', reply({}), async () => null)).toEqual({ result: 'check_failed' });
  });

  it('the code and a password sign in, marked as email', async () => {
    const f = reply({ session: 'vx1.p.s', user: USER, returning: false });
    expect(await verifyEmailCode({ email: 'ravi@example.com', code: '123456', password: 'tabla-rhythm-9', name: 'Ravi' }, f)).toEqual({ result: 'ok' });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({ email: 'ravi@example.com', code: '123456', password: 'tabla-rhythm-9', name: 'Ravi', deviceId: expect.any(String) });
    expect(currentAccount()).toEqual({ session: 'vx1.p.s', user: USER, via: 'email' });
    const wrong = await verifyEmailCode({ email: 'a@b.co', code: '000000', password: 'x'.repeat(8) }, reply({ error: 'wrong_code', triesLeft: 2 }, 400));
    expect(emailAuthMessage(wrong)).toBe('That code isn’t right. 2 tries left.');
  });

  it('email + password signs in; a wrong one says how to set one', async () => {
    const bad = await signInWithPassword('ravi@example.com', 'nope-nope', reply({ error: 'wrong_password' }, 401), noCheck);
    expect(bad.result).toBe('wrong_password');
    expect(emailAuthMessage(bad)).toContain('Forgot password?');
    expect(currentAccount()).toBeNull();
    const ok = await signInWithPassword('ravi@example.com', 'tabla-rhythm-9', reply({ session: 'vx1.p.s', user: USER, returning: true }), noCheck);
    expect(ok).toEqual({ result: 'ok' });
    expect(currentAccount()?.via).toBe('password');
  });

  it('Settings sets a password with the session and marks the account', async () => {
    expect(await setPassword('veena-melody', undefined, reply({ ok: true }))).toEqual({ result: 'signed_out' });
    setLocal(KEYS.account, { session: 'vx1.g.s', user: { ...USER, hasPassword: false }, via: 'google' });
    const f = reply({ ok: true });
    expect(await setPassword('veena-melody', undefined, f)).toEqual({ result: 'ok' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/password');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer vx1.g.s');
    expect(JSON.parse(String(init.body))).toEqual({ password: 'veena-melody' });
    expect(currentAccount()?.user.hasPassword).toBe(true);
    expect((await setPassword('another-one', 'wrong', reply({ error: 'wrong_password' }, 403))).result).toBe('wrong_password');
  });
});
