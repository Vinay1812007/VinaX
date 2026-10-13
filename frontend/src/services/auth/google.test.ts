// @vitest-environment jsdom
/** 12.2 — optional Google sign-in: the token is traded for a VinaX session, which
 *  is kept on the device; the username comes back from the account; sign-out
 *  and account deletion clear it; failures are named. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { currentAccount, deleteAccount, exchangeGoogleToken, onAccountChange, signOut } from './google';
import { signInMessage } from '@/components/GoogleSignIn';

const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const USER = { name: 'A Listener', email: 'a@example.com', picture: null, username: 'vinay' };

beforeEach(() => localStorage.clear());
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
});
