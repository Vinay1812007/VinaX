// @vitest-environment jsdom
/**
 * 11.1.0 — the username claim carries a human-check token, and a refused
 * check parks the claim (reason "check") instead of confirming or blocking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));
const oneShot = vi.fn(async () => 'floating-token');
vi.mock('@/services/turnstile', () => ({ turnstileEnabled: () => true, oneShotHumanToken: () => oneShot() }));

import { claimHandle, pendingClaim } from './handleClaim';

let status = 200;
let reply: unknown = {};
let sent: Record<string, unknown>[] = [];

beforeEach(() => {
  localStorage.clear();
  sent = [];
  oneShot.mockClear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('claimHandle with the human check on', () => {
  it('sends the token from the widget on screen', async () => {
    status = 200;
    reply = { ok: true, username: 'vinay_k' };
    const out = await claimHandle('vinay_k', 'Vinay', async () => 'sheet-token');
    expect(out.status).toBe('confirmed');
    expect(sent[0].turnstile_token).toBe('sheet-token');
    expect(oneShot).not.toHaveBeenCalled();
  });

  it('with no widget on screen (a retry), asks for a one-off token', async () => {
    status = 200;
    reply = { ok: true, username: 'vinay_k' };
    await claimHandle('vinay_k', 'Vinay');
    expect(oneShot).toHaveBeenCalledTimes(1);
    expect(sent[0].turnstile_token).toBe('floating-token');
  });

  it('a refused check (403) parks the claim as pending with reason "check"', async () => {
    status = 403;
    reply = { error: 'challenge' };
    const out = await claimHandle('vinay_k', 'Vinay', async () => null);
    expect(out).toEqual({ status: 'pending', username: 'vinay_k', reason: 'check' });
    expect(sent[0].turnstile_token).toBeUndefined();
    expect(localStorage.getItem(KEYS.userHandle)).toBeNull();
    expect(pendingClaim()).toMatchObject({ username: 'vinay_k', status: 'pending' });
  });
});
