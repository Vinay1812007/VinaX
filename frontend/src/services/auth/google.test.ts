// @vitest-environment jsdom
/** 12.2 — optional Google sign-in: the token is traded for a VinaX session, which
 *  is kept on the device; the username comes back from the account; sign-out
 *  and account deletion clear it; failures are named. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { currentAccount, deleteAccount, exchangeGoogleToken, onAccountChange, resetSessionCheckForTests, signOut, validateSession } from './google';
import { signInMessage } from '@/components/GoogleSignIn';

const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const USER = { name: 'A Listener', email: 'a@example.com', picture: null, username: 'vinay' };

beforeEach(() => {
  localStorage.clear();
  resetSessionCheckForTests();
});
afterEach(() => vi.restoreAllMocks());

describe('Google sign-in', () => {
  it('trades the token for a session, keeps it, and takes the account username and name', async () => {
    localStorage.setItem(KEYS.signedDeviceId, JSON.stringify('signed.device'));
    const seen: Array<unknown> = [];
    const off = onAccountChange((a) => seen.push(a?.user.email));
    const f = ok({ session: 'vx1.payload.sig', user: USER });
    expect(await exchangeGoogleToken('google.id.token', f)).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/google');
    expect(JSON.parse(String(init.body))).toEqual({ credential: 'google.id.token', signed_device_id: 'signed.device' });
    expect(currentAccount()).toEqual({ session: 'vx1.payload.sig', user: USER });
    expect(getLocal(KEYS.userHandle, '')).toBe('vinay');
    expect(getLocal(KEYS.userName, '')).toBe('A Listener');
    expect(seen).toEqual(['a@example.com']);
    signOut();
    expect(currentAccount()).toBeNull();
    expect(seen).toEqual(['a@example.com', undefined]);
    off();
  });

  it('names a refused token and an unavailable service; keeps nothing', async () => {
    expect(await exchangeGoogleToken('bad', ok({ error: 'invalid_token' }, 401))).toBe('refused');
    expect(await exchangeGoogleToken('x', ok({ error: 'not_configured' }, 503))).toBe('unavailable');
    expect(await exchangeGoogleToken('x', vi.fn(async () => Promise.reject(new TypeError('net'))))).toBe('unavailable');
    expect(currentAccount()).toBeNull();
    expect(signInMessage('cancelled')).toBeNull();
    expect(signInMessage('refused')).toMatch(/not accepted/);
  });

  it('deleting the account asks the server, then signs out', async () => {
    await exchangeGoogleToken('t', ok({ session: 'vx1.p.s', user: USER }));
    const f = ok({ ok: true });
    expect(await deleteAccount(f)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer vx1.p.s');
    expect(currentAccount()).toBeNull();
  });

  // 13.4.0 — validateSession rewrote the account on every answer, AuthGate
  // re-ran it for every new object: an endless /api/auth/me loop, and an
  // answer landing after Sign out signed the listener back in.
  it('asks the server once per session, and leaves an unchanged account alone', async () => {
    await exchangeGoogleToken('t', ok({ session: 'vx1.p.s', user: USER }));
    const seen: unknown[] = [];
    const off = onAccountChange((a) => seen.push(a));
    const f = ok({ user: USER });
    expect(await validateSession(f)).toBe(true);
    expect(await validateSession(f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    off();
  });

  it('takes a changed name or photo from the server, once', async () => {
    await exchangeGoogleToken('t', ok({ session: 'vx1.p.s', user: USER }));
    const seen: unknown[] = [];
    const off = onAccountChange((a) => seen.push(a?.user.picture));
    expect(await validateSession(ok({ user: { ...USER, picture: 'https://x/p.jpg' } }))).toBe(true);
    expect(seen).toEqual(['https://x/p.jpg']);
    off();
  });

  it('an answer that lands after Sign out does not sign back in', async () => {
    await exchangeGoogleToken('t', ok({ session: 'vx1.p.s', user: USER }));
    let answer!: (r: Response) => void;
    const slow = vi.fn(() => new Promise<Response>((r) => (answer = r)));
    const pending = validateSession(slow);
    signOut();
    answer(new Response(JSON.stringify({ user: USER }), { status: 200 }));
    expect(await pending).toBe(false);
    expect(currentAccount()).toBeNull();
  });

  it('a 401 signs out; checks running at once share one request', async () => {
    await exchangeGoogleToken('t', ok({ session: 'vx1.p.s', user: USER }));
    const f = ok({ error: 'expired' }, 401);
    const [a, b] = await Promise.all([validateSession(f), validateSession(f)]);
    expect([a, b]).toEqual([false, false]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(currentAccount()).toBeNull();
  });
});
