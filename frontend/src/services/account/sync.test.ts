// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { RETURNING_EVENT, syncNow } from './sync';

describe('V2 — the first sync recognises a returning account', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'A', email: 'a@x', picture: null, username: null } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a server copy marks this browser welcomed and tells the welcome to close', async () => {
    const heard = vi.fn();
    window.addEventListener(RETURNING_EVENT, heard);
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ version: 4 }), { status: 200 })
        : new Response(JSON.stringify({ version: 3, backup: { format: 'vinax-backup', schemaVersion: 2, categories: {} } }), { status: 200 }),
    );
    await syncNow(f as unknown as typeof fetch);
    expect(getLocal(KEYS.onboarded, false)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(RETURNING_EVENT, heard);
  });

  it('a pull names the version this device holds, and an unchanged answer merges nothing', async () => {
    localStorage.setItem('vinax.account.sync.v1', JSON.stringify({ who: 'a@x', version: 7, pushed: '', at: 0 }));
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ version: 8 }), { status: 200 })
        : new Response(JSON.stringify({ version: 7, updatedAt: '2026-11-27T00:00:00Z', unchanged: true }), { status: 200 }),
    );
    await syncNow(f as unknown as typeof fetch);
    expect(f.mock.calls[0][0]).toMatch(/\/api\/account\/data\?have=7$/);
    expect(f.mock.calls[1][1]?.method).toBe('PUT');
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).version).toBe(7);
  });

  it('an account with nothing on the server (204) is left to the welcome', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? new Response(JSON.stringify({ version: 1 }), { status: 200 }) : new Response(null, { status: 204 }),
    );
    await syncNow(f as unknown as typeof fetch);
    expect(getLocal(KEYS.onboarded, false)).toBe(false);
  });
});
