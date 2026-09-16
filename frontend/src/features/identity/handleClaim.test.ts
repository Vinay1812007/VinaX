// @vitest-environment jsdom
/**
 * Username claim state — a failed claim must stay PENDING (never stored as
 * confirmed), a refused one must stay TAKEN, and reconnecting must retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import { claimHandle, handleStatus, installClaimRetry, pendingClaim, retryPendingClaim } from './handleClaim';

type Reply = { status: number; body?: unknown } | Error;
let replies: Reply[] = [];
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  localStorage.clear();
  replies = [];
  calls = [];
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      const next = replies.shift() ?? new Error('no reply queued');
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { 'content-type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const stored = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown;

describe('claimHandle', () => {
  it('stores the handle as confirmed only when the service says ok, and keeps the issued token', async () => {
    replies = [{ status: 200, body: { ok: true, username: 'vinay_k', signed_device_id_next: 'id.sig' } }];
    const out = await claimHandle('Vinay_K', 'Vinay');
    expect(out).toEqual({ status: 'confirmed', username: 'vinay_k' });
    expect(stored(KEYS.userHandle)).toBe('vinay_k');
    expect(stored(KEYS.signedDeviceId)).toBe('id.sig');
    expect(stored(KEYS.userHandlePending)).toBeNull();
    expect(handleStatus()).toEqual({ state: 'confirmed', handle: 'vinay_k' });
    // The claim carries the install id and (no) current handle.
    expect(typeof calls[0].body.deviceId).toBe('string');
    expect(calls[0].body.current_username).toBeUndefined();
  });

  it('a network failure leaves the claim PENDING — never confirmed', async () => {
    replies = [new Error('offline')];
    const out = await claimHandle('vinay_k', 'Vinay');
    expect(out.status).toBe('pending');
    expect(stored(KEYS.userHandle)).toBeNull();
    expect(pendingClaim()).toMatchObject({ username: 'vinay_k', name: 'Vinay', status: 'pending' });
    expect(handleStatus().state).toBe('pending');
  });

  it('a 5xx / non-ok reply also parks the claim instead of saving it', async () => {
    replies = [{ status: 503, body: { error: 'unavailable' } }, { status: 200, body: { ok: false } }];
    expect((await claimHandle('vinay_k', 'Vinay')).status).toBe('pending');
    expect((await claimHandle('vinay_k', 'Vinay')).status).toBe('pending');
    expect(stored(KEYS.userHandle)).toBeNull();
  });

  it('being offline parks the claim without touching the network', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const out = await claimHandle('vinay_k', 'Vinay');
    expect(out).toEqual({ status: 'pending', username: 'vinay_k', reason: 'offline' });
    expect(calls).toHaveLength(0);
  });

  it('a 409 records the choice as TAKEN with the suggestions', async () => {
    replies = [{ status: 409, body: { error: 'taken', suggestions: ['vinay_k_1234'] } }];
    const out = await claimHandle('vinay_k', 'Vinay');
    expect(out).toEqual({ status: 'taken', username: 'vinay_k', suggestions: ['vinay_k_1234'] });
    expect(stored(KEYS.userHandle)).toBeNull();
    expect(handleStatus()).toEqual({ state: 'taken', handle: 'vinay_k', suggestions: ['vinay_k_1234'] });
  });

  it('sends the confirmed handle as current_username when renaming', async () => {
    localStorage.setItem(KEYS.userHandle, JSON.stringify('old_name'));
    replies = [{ status: 200, body: { ok: true, username: 'new_name' } }];
    await claimHandle('new_name', 'Vinay');
    expect(calls[0].body.current_username).toBe('old_name');
    expect(stored(KEYS.userHandle)).toBe('new_name');
  });
});

describe('retry on reconnect', () => {
  it('retryPendingClaim re-sends a pending claim and confirms it', async () => {
    replies = [new Error('offline'), { status: 200, body: { ok: true, username: 'vinay_k' } }];
    await claimHandle('vinay_k', 'Vinay');
    const out = await retryPendingClaim();
    expect(out?.status).toBe('confirmed');
    expect(stored(KEYS.userHandle)).toBe('vinay_k');
    expect(pendingClaim()).toBeNull();
  });

  it('does nothing when nothing is pending or the choice was refused', async () => {
    expect(await retryPendingClaim()).toBeNull();
    replies = [{ status: 409, body: { suggestions: [] } }];
    await claimHandle('vinay_k', 'Vinay');
    calls = [];
    expect(await retryPendingClaim()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('installClaimRetry fires on the online event', async () => {
    // Offline claims never touch fetch, so only the retry's reply is queued.
    replies = [{ status: 200, body: { ok: true, username: 'vinay_k' } }];
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await claimHandle('vinay_k', 'Vinay');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    calls = [];
    const stop = installClaimRetry(); // pending → retries immediately
    await vi.waitFor(() => expect(stored(KEYS.userHandle)).toBe('vinay_k'));
    stop();
  });
});
