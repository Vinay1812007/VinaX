/**
 * 7.2.0 — durable rate limiting (security H-SRV-11). The in-memory limiter
 * and the admin failed-login throttle live in one isolate's memory, so a
 * client that spreads requests across isolates multiplies every limit. With
 * the Workers Rate Limiting binding the count is shared by every isolate in a
 * location. Each fresh module instance below stands in for a separate
 * isolate; the fake binding stands in for the location-wide counter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const compare = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../functions/_lib/safe-compare', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../functions/_lib/safe-compare')>();
  return {
    safeEqual: (a: string | null | undefined, b: string | null | undefined) => {
      compare.calls += 1;
      return actual.safeEqual(a, b);
    },
  };
});

type RateLimitModule = typeof import('../functions/_lib/ratelimit');
type AdminModule = typeof import('../functions/_lib/admin');

/** A fresh copy of the module graph — its own in-memory buckets, like a new isolate. */
async function isolate(): Promise<{ rl: RateLimitModule; admin: AdminModule }> {
  vi.resetModules();
  const rl = await import('../functions/_lib/ratelimit');
  const admin = await import('../functions/_lib/admin');
  return { rl, admin };
}

/** Location-wide counter: a fixed 60 s window per key, shared by every "isolate". */
function fakeBinding(limit: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    counts,
    limit: vi.fn(async ({ key }: { key: string }) => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    }),
  };
}

const req = (ip: string, extra: Record<string, string> = {}) =>
  new Request('https://www.sirimillavinay.online/api/x', { method: 'POST', headers: { 'cf-connecting-ip': ip, ...extra } });

beforeEach(() => { compare.calls = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('rate-limit tiers', () => {
  it('each route maps to the smallest tier at or above capacity + one minute of refill', async () => {
    const { rl } = await isolate();
    expect(rl.tierFor({ capacity: 4, refillPerMinute: 2 })?.binding).toBe('RATE_LIMIT_10'); // admin-health
    expect(rl.tierFor({ capacity: 6, refillPerMinute: 3 })?.binding).toBe('RATE_LIMIT_10'); // playlist, image
    expect(rl.tierFor({ capacity: 12, refillPerMinute: 6 })?.binding).toBe('RATE_LIMIT_30'); // curate
    expect(rl.tierFor({ capacity: 15, refillPerMinute: 8 })?.binding).toBe('RATE_LIMIT_30'); // dj
    expect(rl.tierFor({ capacity: 20, refillPerMinute: 10 })?.binding).toBe('RATE_LIMIT_30'); // vinaxai
    expect(rl.tierFor({ capacity: 30, refillPerMinute: 30 })?.binding).toBe('RATE_LIMIT_60'); // tts
    expect(rl.tierFor({ capacity: 60, refillPerMinute: 60 })?.binding).toBe('RATE_LIMIT_300'); // events
    expect(rl.tierFor({ capacity: 400, refillPerMinute: 400 })).toBeNull();
  });
});

describe('rateLimitAsync', () => {
  it('without a binding it is exactly the in-memory bucket (tests, local dev)', async () => {
    const { rl } = await isolate();
    const opts = { capacity: 2, refillPerMinute: 1 };
    expect(await rl.rateLimitAsync(req('203.0.113.1'), 'r', opts, {})).toBeNull();
    expect(await rl.rateLimitAsync(req('203.0.113.1'), 'r', opts, {})).toBeNull();
    const third = await rl.rateLimitAsync(req('203.0.113.1'), 'r', opts, {});
    expect(third?.status).toBe(429);
  });

  it('sharding across isolates no longer multiplies the limit', async () => {
    const opts = { capacity: 6, refillPerMinute: 3 }; // tier RATE_LIMIT_10
    // In memory only: three isolates admit 3 × 6 requests.
    let admitted = 0;
    for (let i = 0; i < 3; i += 1) {
      const { rl } = await isolate();
      for (let j = 0; j < 10; j += 1) if (!(await rl.rateLimitAsync(req('203.0.113.2'), 'playlist', opts, {}))) admitted += 1;
    }
    expect(admitted).toBe(18);
    // With the location-wide binding: at most its limit, however the requests are spread.
    const binding = fakeBinding(10);
    const env = { RATE_LIMIT_10: binding };
    admitted = 0;
    for (let i = 0; i < 3; i += 1) {
      const { rl } = await isolate();
      for (let j = 0; j < 10; j += 1) if (!(await rl.rateLimitAsync(req('203.0.113.2'), 'playlist', opts, env))) admitted += 1;
    }
    expect(admitted).toBe(10);
  });

  it('a binding refusal is a 429 the client can back off from; keys never carry the raw address', async () => {
    const { rl } = await isolate();
    const binding = fakeBinding(0);
    const res = await rl.rateLimitAsync(req('203.0.113.3'), 'curate', { capacity: 12, refillPerMinute: 6 }, { RATE_LIMIT_30: binding });
    expect(res?.status).toBe(429);
    expect(res?.headers.get('retry-after')).toBe('60');
    expect(((await res?.json()) as { error: string }).error).toBe('rate_limited');
    expect(binding.keys[0]).toMatch(/^curate\|[0-9a-f]{16}$/);
    expect(binding.keys[0]).not.toContain('203.0.113.3');
  });

  it('a failing binding fails open to the in-memory limiter', async () => {
    const { rl } = await isolate();
    const broken = { limit: vi.fn(async () => { throw new Error('binding down'); }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const opts = { capacity: 1, refillPerMinute: 1 };
    expect(await rl.rateLimitAsync(req('203.0.113.4'), 'r', opts, { RATE_LIMIT_10: broken })).toBeNull();
    expect((await rl.rateLimitAsync(req('203.0.113.4'), 'r', opts, { RATE_LIMIT_10: broken }))?.status).toBe(429);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a route answers the binding refusal before doing any work (events: nothing is written)', async () => {
    vi.resetModules();
    const { onRequestPost } = await import('../functions/api/events');
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await onRequestPost({
      request: new Request('https://www.sirimillavinay.online/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vinax-consent': 'analytics', 'cf-connecting-ip': '203.0.113.5' },
        body: JSON.stringify({ deviceId: 'install-uuid-0001', type: 'play' }),
      }),
      env: { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', RATE_LIMIT_300: fakeBinding(0) } as never,
    });
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('isAdminAsync — the failed-login throttle', () => {
  const ENV = { ADMIN_LOGIN_PASSWORD: 'right-token' };
  const tok = (ip: string, token: string) => req(ip, { 'x-admin-token': token });

  it('without a binding it keeps today\'s per-isolate lockout, refusing without comparing', async () => {
    const { admin } = await isolate();
    for (let i = 0; i < 15; i += 1) expect(await admin.isAdminAsync(tok('198.51.100.40', `wrong-${i}`), ENV)).toBe(false);
    const before = compare.calls;
    expect(await admin.isAdminAsync(tok('198.51.100.40', 'right-token'), ENV)).toBe(false);
    expect(compare.calls).toBe(before); // locked out: not even compared
    expect(await admin.isAdminAsync(tok('198.51.100.41', 'right-token'), ENV)).toBe(true);
  });

  it('spreading guesses across isolates: in memory each isolate grants 15; the shared counter caps the location', async () => {
    const guesses = 45;
    // In memory only: 3 isolates × 15 compares.
    let isolates: AdminModule[] = [];
    for (let i = 0; i < 3; i += 1) isolates.push((await isolate()).admin); // sequential: one module graph each
    compare.calls = 0;
    for (let i = 0; i < guesses; i += 1) await isolates[i % 3].isAdminAsync(tok('198.51.100.50', `wrong-${i}`), ENV);
    expect(compare.calls).toBe(45);

    // With ADMIN_AUTH_FAILS (15 per 60 s per source, per location).
    const binding = fakeBinding(15);
    const env = { ...ENV, ADMIN_AUTH_FAILS: binding };
    isolates = [];
    for (let i = 0; i < 3; i += 1) isolates.push((await isolate()).admin);
    compare.calls = 0;
    for (let i = 0; i < guesses; i += 1) await isolates[i % 3].isAdminAsync(tok('198.51.100.51', `wrong-${i}`), env);
    // 15 within budget, then one more per isolate before each locks the source.
    expect(compare.calls).toBe(15 + 3);
    // A later correct guess from the same source is refused WITHOUT comparing, everywhere.
    const before = compare.calls;
    for (const a of isolates) expect(await a.isAdminAsync(tok('198.51.100.51', 'right-token'), env)).toBe(false);
    expect(compare.calls).toBe(before);
    // Another source with the right token is unaffected.
    expect(await isolates[0].isAdminAsync(tok('198.51.100.52', 'right-token'), env)).toBe(true);
  });

  it('correct tokens never spend the shared failure budget', async () => {
    const { admin } = await isolate();
    const binding = fakeBinding(15);
    for (let i = 0; i < 50; i += 1) expect(await admin.isAdminAsync(tok('198.51.100.60', 'right-token'), { ...ENV, ADMIN_AUTH_FAILS: binding })).toBe(true);
    expect(binding.limit).not.toHaveBeenCalled();
  });

  it('a failing binding leaves the per-isolate throttle in charge', async () => {
    const { admin } = await isolate();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = { ...ENV, ADMIN_AUTH_FAILS: { limit: async () => { throw new Error('down'); } } };
    for (let i = 0; i < 15; i += 1) await admin.isAdminAsync(tok('198.51.100.70', `wrong-${i}`), env);
    expect(await admin.isAdminAsync(tok('198.51.100.70', 'right-token'), env)).toBe(false);
    expect(await admin.isAdminAsync(tok('198.51.100.71', 'right-token'), env)).toBe(true);
    warn.mockRestore();
  });
});
