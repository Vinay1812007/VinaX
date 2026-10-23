/**
 * 13.9 — Android and web listeners in the console. The Listeners and Overview
 * routes report every signed-in account and every usage device split by
 * platform, and `?platform=` narrows the Listeners list on both sources.
 * Each test drives the real handler against a stubbed database REST layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as usersGet } from '../functions/api/admin/users';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview';
import { platformParam, readPlatforms } from '../functions/_lib/platforms';

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

interface Call { url: string; method: string }
const calls: Call[] = [];
const rows = (v: unknown, total: number) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json', 'content-range': `0-0/${total}` } });

/** Counts answered by the stub: the `content-range` total for a URL that contains the key. */
function db(counts: Record<string, number>, rpc: Record<string, unknown> = {}): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    calls.push({ url, method: init?.method ?? 'GET' });
    const fn = /\/rpc\/([a-z_]+)/.exec(url)?.[1];
    if (fn) return Promise.resolve(rows(fn in rpc ? rpc[fn] : null, 0));
    for (const [key, n] of Object.entries(counts)) if (url.includes(key)) return Promise.resolve(rows([], n));
    return Promise.resolve(rows([], 0));
  });
}

function req(path: string): Request {
  return new Request(`https://admin.test${path}`, { headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '10.139.0.7' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('platformParam', () => {
  it('accepts only the platforms the app reports', () => {
    expect(platformParam('android')).toBe('android');
    expect(platformParam(' Web ')).toBe('web');
    expect(platformParam('ios')).toBe('ios');
    expect(platformParam('pwa')).toBe('');
    expect(platformParam(null)).toBe('');
    expect(platformParam('android)')).toBe('');
  });
});

describe('readPlatforms', () => {
  it('splits accounts (all and account-only) and lists devices', async () => {
    db(
      {
        'vinax_accounts?select=*&limit=1&platform=eq.web': 7,
        'vinax_accounts?select=*&limit=1&platform=eq.android': 5,
        'vinax_accounts?select=*&limit=1&platform=eq.ios': 1,
        'vinax_accounts?select=*&limit=1&device_id=is.null&platform=eq.web': 3,
        'vinax_accounts?select=*&limit=1&device_id=is.null&platform=eq.android': 2,
        'vinax_accounts?select=*&limit=1&device_id=is.null&platform=eq.ios': 0,
        'vinax_accounts?select=*&limit=1&device_id=is.null': 6,
        'vinax_accounts?select=*&limit=1': 15,
      },
      { vinax_platforms: [{ platform: 'android', listeners: '9' }, { platform: null, listeners: 4 }] },
    );
    const p = await readPlatforms(ENV);
    expect(p.accounts).toEqual({ web: 7, android: 5, ios: 1, other: 2, total: 15 });
    expect(p.accountsOnly).toEqual({ web: 3, android: 2, ios: 0, other: 1, total: 6 });
    expect(p.devices).toEqual([{ platform: 'android', listeners: 9 }, { platform: 'web', listeners: 4 }]);
  });

  it('a half that cannot be read is null, never zero', async () => {
    calls.length = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rpc/')) return Promise.resolve(new Response('oops', { status: 500 }));
      if (url.includes('platform=eq.android')) return Promise.resolve(new Response('[]', { status: 200 })); // no content-range
      return Promise.resolve(rows([], 2));
    });
    const p = await readPlatforms(ENV);
    expect(p.accounts).toBeNull();
    expect(p.accountsOnly).toBeNull();
    expect(p.devices).toBeNull();
  });
});

describe('GET /api/admin/users', () => {
  it('?platform=android narrows the device read AND the account read, and echoes the filter', async () => {
    db({}, { vinax_user_summary: { total_users: 0, active_24h: 0, new_24h: 0, total_plays: 0 } });
    const res = await usersGet({ request: req('/api/admin/users?platform=android'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { platform: string; platforms?: unknown };
    expect(body.platform).toBe('android');
    const devices = calls.find((c) => c.url.includes('/vinax_users?select=device_id'));
    const accounts = calls.find((c) => c.url.includes('/vinax_accounts?select=google_sub'));
    expect(devices?.url).toContain('platform=eq.android');
    expect(accounts?.url).toContain('device_id=is.null&platform=eq.android');
    // Devices now carry their build and region for the console's columns.
    expect(devices?.url).toContain('app_version');
    expect(devices?.url).toContain('region');
    expect(body.platforms).toBeDefined();
  });

  it('an unknown platform means no filter, and a later page carries no platform split', async () => {
    db({}, { vinax_user_summary: { total_users: 0, active_24h: 0, new_24h: 0, total_plays: 0 } });
    const res = await usersGet({ request: req('/api/admin/users?platform=pwa&offset=50'), env: ENV });
    const body = (await res.json()) as { platform: string; platforms?: unknown };
    expect(body.platform).toBe('');
    expect(body.platforms).toBeUndefined();
    const devices = calls.find((c) => c.url.includes('/vinax_users?select=device_id'));
    expect(devices?.url).not.toContain('platform=eq');
    expect(calls.some((c) => c.url.includes('/rpc/vinax_platforms'))).toBe(false);
  });
});

describe('GET /api/admin/overview', () => {
  it('carries the platform split next to the account counts', async () => {
    db(
      { 'platform=eq.android': 4, 'platform=eq.web': 10 },
      {
        vinax_overview: { active_now: 0, total_users: 0, new_today: 0, plays_today: 0, plays_7d: 0, errors_24h: 0, dau: 0, wau: 0, mau: 0, feedback_new: 0 },
        vinax_new_users_by_day: [], vinax_plays_by_day: [], vinax_top_songs: [], vinax_geo: [], vinax_platforms: [],
      },
    );
    const res = await overviewGet({ request: req('/api/admin/overview'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { platforms: { accounts: { android: number; web: number } | null; devices: unknown[] | null } };
    expect(body.platforms.accounts?.android).toBe(4);
    expect(body.platforms.accounts?.web).toBe(10);
    expect(body.platforms.devices).toEqual([]);
  });
});
