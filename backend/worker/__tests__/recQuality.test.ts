import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateRecQuality, distribution, onRequestGet, wilson, MIN_DEVICES, type RecEventRow } from '../functions/api/admin/recquality';

/**
 * Recommendation quality is read from OPT-IN telemetry only. These tests pin
 * the aggregation on fixtures (small samples stay visibly uncertain, groups
 * under MIN_DEVICES withhold their rates, untrusted meta is dropped) and the
 * route's contract (admin gate before any work, failures are not zeros, a
 * missing meta column is "not provisioned", nothing per-listener leaves).
 */

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let ipSeq = 0;
const req = (qs = 'days=7', token = 'test-secret'): Request => {
  ipSeq += 1;
  return new Request(`https://admin.test/api/admin/recquality?${qs}`, { headers: { 'x-admin-token': token, 'cf-connecting-ip': `10.21.0.${ipSeq % 250}` } });
};

const at = (min: number): string => new Date(Date.UTC(2026, 8, 18, 10, min)).toISOString();
const served = (device: string, min: number, meta: Record<string, unknown>): RecEventRow => ({
  type: 'rec_served', device_id: device, created_at: at(min),
  meta: { alg: '1.2.0', picker: 'local', fallback: null, latencyMs: 400, n: 5, discovery: 1, languageViolations: 0, relaxed: [], exp: {}, ...meta },
});
const outcome = (device: string, song: string, min: number, meta: Record<string, unknown>): RecEventRow => ({
  type: 'rec_outcome', device_id: device, song_id: song, created_at: at(min),
  meta: { alg: '1.2.0', picker: 'local', pos: 1, heardSec: 200, durationSec: 210, outcome: 'complete', liked: false, exp: {}, ...meta },
});

describe('wilson interval', () => {
  it('is null without trials and wide for a handful', () => {
    expect(wilson(0, 0)).toEqual({ k: 0, n: 0, rate: null, low: null, high: null });
    const small = wilson(3, 5);
    expect(small.rate).toBe(0.6);
    expect(small.low!).toBeLessThan(0.25);
    expect(small.high!).toBeGreaterThan(0.85);
    const big = wilson(600, 1000);
    expect(big.high! - big.low!).toBeLessThan(0.07);
  });
  it('stays inside 0..1 at the extremes', () => {
    expect(wilson(0, 4).low).toBe(0);
    expect(wilson(4, 4).high).toBe(1);
    expect(wilson(4, 4).low!).toBeLessThan(0.55);
  });
});

describe('distribution', () => {
  it('gives a median interval that spans the sample when it is tiny, and withholds p95 below 20 samples', () => {
    const d = distribution([30, 10, 20]);
    expect(d).toMatchObject({ n: 3, p50: 20, p50Low: 10, p50High: 30, p95: null });
  });
  it('narrows with more data', () => {
    const d = distribution(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(d.p50).toBe(50);
    expect(d.p50Low).toBe(40);
    expect(d.p50High).toBe(61);
    expect(d.p95).toBe(95);
  });
});

describe('aggregateRecQuality', () => {
  const rows: RecEventRow[] = [
    served('d1', 0, { latencyMs: 300 }),
    served('d2', 1, { picker: 'ai', latencyMs: 2000, exp: { 'rec-weights': 'treatment' } }),
    served('d3', 2, { fallback: 'ai_timeout', latencyMs: 9000, languageViolations: 2, relaxed: ['language-lock', 'language-lock'] }),
    served('d4', 3, { alg: '1.2.0+rc7', fallback: 'something-new', exp: { 'rec-weights': 'treatment' } }),
    outcome('d1', 's1', 10, { outcome: 'complete', heardSec: 210, liked: true }),
    outcome('d1', 's2', 11, { outcome: 'skip', heardSec: 12 }),
    outcome('d2', 's3', 12, { outcome: 'early_skip', heardSec: 5, picker: 'ai', exp: { 'rec-weights': 'treatment' } }),
    outcome('d3', 's4', 13, { outcome: 'partial', heardSec: 90 }),
    outcome('d1', 's1', 20, { outcome: 'skip', heardSec: 45 }), // the same song again for d1: a repeat
  ];
  const r = aggregateRecQuality(rows);

  it('counts served continuations, exposures and devices', () => {
    expect(r.devices).toBe(4);
    expect(r.overall).toMatchObject({ key: 'all', devices: 4, continuations: 4, exposures: 5, withheld: false });
    expect(r.overall.served?.songs).toBe(20);
  });

  it('computes outcome rates with their sample counts', () => {
    const o = r.overall.outcomes!;
    expect(o.completion).toMatchObject({ k: 1, n: 5 });
    expect(o.skip).toMatchObject({ k: 3, n: 5 });
    // early skip = early_skip, or skip with < 30 s heard (the 45 s skip is not early)
    expect(o.earlySkip).toMatchObject({ k: 2, n: 5 });
    expect(o.likes).toMatchObject({ k: 1, n: 5 });
    expect(o.repeats).toMatchObject({ k: 1, n: 5 });
    expect(o.heardSec).toMatchObject({ n: 5, p50: 45, p95: null });
    // five exposures cannot support a precise percentage
    expect(o.completion.high! - o.completion.low!).toBeGreaterThan(0.5);
  });

  it('breaks fallbacks down by reason and keeps unknown reasons as "other"', () => {
    const s = r.overall.served!;
    expect(s.fallback).toMatchObject({ k: 2, n: 4 });
    expect(s.fallback.byReason).toEqual({ ai_timeout: 1, other: 1 });
    expect(s.languageViolations.songs).toBe(2);
    expect(s.relaxed).toEqual({ 'language-lock': 1 });
    expect(s.latencyMs).toMatchObject({ n: 4, p50: 400, p95: null });
    expect(s.diversity).toEqual({ n: 0, mean: null }); // not in this telemetry version
  });

  it('withholds the rates of any group with fewer than MIN_DEVICES devices, but keeps its counts', () => {
    expect(MIN_DEVICES).toBe(3);
    const rc7 = r.byAlg.find((g) => g.key === '1.2.0+rc7')!;
    expect(rc7).toMatchObject({ devices: 1, continuations: 1, withheld: true, served: null, outcomes: null });
    const ai = r.byPicker.find((g) => g.key === 'ai')!;
    expect(ai).toMatchObject({ devices: 1, withheld: true });
    const local = r.byPicker.find((g) => g.key === 'local')!;
    expect(local.withheld).toBe(false);
    expect(local.devices).toBe(3);
  });

  it('groups by experiment variant from meta.exp', () => {
    expect(r.byVariant.map((g) => g.key).sort()).toEqual(['(no experiment)', 'rec-weights: treatment']);
    expect(r.byVariant.find((g) => g.key === 'rec-weights: treatment')).toMatchObject({ devices: 2, continuations: 2, exposures: 1 });
  });

  it('treats meta as untrusted: junk values are dropped, not guessed', () => {
    const junk = aggregateRecQuality([
      { type: 'rec_served', device_id: 'x1', meta: { n: -5, latencyMs: Number.NaN, picker: '<img src=x onerror=alert(1)>', exp: { 'Bad Key!': 'v', ok: '' } } },
      { type: 'rec_served', device_id: 'x2', meta: 'not an object' },
      { type: 'rec_outcome', device_id: 'admin', song_id: 's', meta: { outcome: 'complete' } },
      { type: 'play', device_id: 'x3', meta: {} },
    ]);
    expect(junk.devices).toBe(1);
    expect(junk.overall.continuations).toBe(1);
    expect(junk.byPicker[0].key).toBe('(unknown)');
    expect(junk.byVariant[0].key).toBe('(no experiment)');
  });

  it('never lets a device id or song id out', () => {
    const text = JSON.stringify(r);
    for (const secret of ['d1', 'd2', 'd3', 'd4', 's1', 's2', 's3', 's4']) expect(text).not.toContain(`"${secret}"`);
  });
});

describe('GET /api/admin/recquality', () => {
  const calls: string[] = [];
  const stub = (handler: (url: string) => Response) => {
    calls.length = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(handler(url));
    });
  };
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a missing or wrong token before touching the database', async () => {
    stub(() => new Response('[]'));
    expect((await onRequestGet({ request: req('days=7', 'wrong'), env: ENV })).status).toBe(401);
    const bare = new Request('https://admin.test/api/admin/recquality', { headers: { 'cf-connecting-ip': '10.21.9.9' } });
    expect((await onRequestGet({ request: bare, env: ENV })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('asks only for rec_served / rec_outcome rows, and only the columns it needs', async () => {
    stub(() => new Response('[]', { status: 200 }));
    const res = await onRequestGet({ request: req('days=abc'), env: ENV });
    expect(res.status).toBe(200);
    expect(calls[0]).toContain('type=in.(rec_served,rec_outcome)');
    expect(calls[0]).toContain('select=type,device_id,song_id,created_at,meta');
    const body = (await res.json()) as { provisioned: boolean; scope: string; days: number; devices: number; overall: { withheld: boolean } };
    expect(body).toMatchObject({ provisioned: true, scope: 'opt-in', days: 7, devices: 0 });
    expect(body.overall.withheld).toBe(true);
  });

  it('a failed read is a 502 with its kind, never zeros', async () => {
    stub(() => new Response('{"message":"boom"}', { status: 500 }));
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('db_unavailable');
    expect(body.overall).toBeUndefined();
  });

  it('a missing meta column is reported as not provisioned', async () => {
    stub((url) => (url.includes('meta') ? new Response('{"code":"42703"}', { status: 400 }) : new Response('[{"type":"play"}]', { status: 200 })));
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ configured: true, provisioned: false, error: 'meta_not_provisioned' });
    expect(body.overall).toBeUndefined();
  });

  it('a 400 that is not about meta stays a failure', async () => {
    stub(() => new Response('{}', { status: 400 }));
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('db_bad_request');
  });

  it('without a database it says so', async () => {
    const res = await onRequestGet({ request: req(), env: { ADMIN_LOGIN_PASSWORD: 'test-secret' } });
    expect(await res.json()).toEqual({ configured: false });
  });
});
