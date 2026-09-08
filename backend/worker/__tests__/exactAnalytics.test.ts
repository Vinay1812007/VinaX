/**
 * v5.16.0 — the Feature Usage / Onboarding Funnel / Skip Report panels read
 * exact rollups from the vinax_usage / vinax_funnel / vinax_skips RPCs and
 * fall back to the newest-10k sample when the migration is not applied.
 * sbRpc is mocked at the module boundary; the sampled path still drives the
 * real REST helper through a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sbRpc } from '../functions/_lib/supabase';
import { onRequestGet as usageGet, usageFromRows } from '../functions/api/admin/usage';
import { onRequestGet as funnelGet, funnel, withPct } from '../functions/api/admin/funnel';
import { onRequestGet as skipsGet, skipTable } from '../functions/api/admin/skips';

vi.mock('../functions/_lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../functions/_lib/supabase')>();
  return { ...actual, sbRpc: vi.fn(async () => null) };
});

const rpc = vi.mocked(sbRpc);

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

const calls: string[] = [];
function stubRest(rows: unknown[]): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

let ipSeq = 0;
function req(path: string): Request {
  ipSeq += 1;
  return new Request(`https://admin.test${path}`, {
    headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.7.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  rpc.mockReset();
  rpc.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

const EVENTS = [
  { type: 'play', platform: 'android', device_id: 'a', song_id: 's1', song_title: 'One', song_artist: 'X', song_image: '', created_at: '2026-09-07T12:00:00Z' },
  { type: 'play', platform: 'android', device_id: 'b', song_id: 's1', song_title: 'One', song_artist: 'X', song_image: '', created_at: '2026-09-07T12:05:00Z' },
  { type: 'skip', platform: 'web', device_id: 'a', song_id: 's1', song_title: 'One', song_artist: 'X', song_image: '', created_at: '2026-09-07T12:06:00Z' },
  { type: 'register', platform: 'web', device_id: 'a', song_id: null, song_title: null, song_artist: null, song_image: null, created_at: '2026-09-07T11:00:00Z' },
];

describe('usage panel', () => {
  it('passes the RPC rollup through as source:exact without touching REST', async () => {
    const rollup = {
      byType: [{ type: 'play', n: 40, devices: 7 }],
      byPlatform: [{ platform: 'android', n: 40 }],
      heatmap: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
      peak: { day: 1, hour: 20, n: 9 },
      total: 40,
    };
    rpc.mockResolvedValueOnce(rollup);
    stubRest([]);
    const res = await usageGet({ request: req('/api/admin/usage?days=3'), env: ENV });
    const body = (await res.json()) as Record<string, unknown>;
    expect(rpc).toHaveBeenCalledWith(ENV, 'vinax_usage', { p_days: 3 });
    expect(body.source).toBe('exact');
    expect(body.sampled).toBe(40);
    expect(body.byType).toEqual(rollup.byType);
    expect(body.peak).toEqual(rollup.peak);
    expect(body.heatmap).toHaveLength(7);
    expect(calls).toHaveLength(0);
  });

  it('falls back to the sampled REST read when the RPC is missing', async () => {
    stubRest(EVENTS);
    const res = await usageGet({ request: req('/api/admin/usage?days=7'), env: ENV });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe('sampled');
    expect(body.sampled).toBe(EVENTS.length);
    expect(calls[0]).toContain('vinax_events?created_at=gte.');
    expect(calls[0]).toContain('limit=10000');
    expect(body.byType).toEqual(usageFromRows(EVENTS).byType);
  });
});

describe('funnel panel', () => {
  it('adds pct to the exact RPC steps and reports source:exact', async () => {
    rpc.mockResolvedValueOnce([
      { id: 'open', label: 'Opened the app', devices: 200 },
      { id: 'register', label: 'Chose a name', devices: 50 },
    ]);
    stubRest([]);
    const res = await funnelGet({ request: req('/api/admin/funnel?days=14'), env: ENV });
    const body = (await res.json()) as { source: string; sampled: number; steps: Array<{ id: string; pct: number }> };
    expect(rpc).toHaveBeenCalledWith(ENV, 'vinax_funnel', { p_days: 14 });
    expect(body.source).toBe('exact');
    expect(body.sampled).toBe(200);
    expect(body.steps).toEqual([
      { id: 'open', label: 'Opened the app', devices: 200, pct: 100 },
      { id: 'register', label: 'Chose a name', devices: 50, pct: 25 },
    ]);
    expect(calls).toHaveLength(0);
  });

  it('samples through REST when the RPC is missing (pct against step one)', async () => {
    stubRest(EVENTS);
    const res = await funnelGet({ request: req('/api/admin/funnel'), env: ENV });
    const body = (await res.json()) as { source: string; steps: unknown };
    expect(body.source).toBe('sampled');
    expect(body.steps).toEqual(funnel(EVENTS));
    expect(calls[0]).toContain('type=in.(open,register,play,heartbeat,complete,favorite,search,share)');
  });

  it('withPct guards an empty first step', () => {
    expect(withPct([])).toEqual([]);
    expect(withPct([{ id: 'open', label: 'o', devices: 0 }, { id: 'play', label: 'p', devices: 0 }])).toEqual([
      { id: 'open', label: 'o', devices: 0, pct: 0 },
      { id: 'play', label: 'p', devices: 0, pct: 0 },
    ]);
  });
});

describe('skip report', () => {
  it('passes the exact ranking through with days and min forwarded to the RPC', async () => {
    const items = [{ id: 's9', title: 'Nine', artist: 'Y', image: '', plays: 12, skips: 9, rate: 75 }];
    rpc.mockResolvedValueOnce(items);
    stubRest([]);
    const res = await skipsGet({ request: req('/api/admin/skips?days=30&min=10'), env: ENV });
    const body = (await res.json()) as Record<string, unknown>;
    expect(rpc).toHaveBeenCalledWith(ENV, 'vinax_skips', { p_days: 30, p_min: 10 });
    expect(body.source).toBe('exact');
    expect(body.items).toEqual(items);
    expect(body.sampled).toBe(21);
    expect(calls).toHaveLength(0);
  });

  it('samples through REST when the RPC is missing', async () => {
    stubRest(EVENTS);
    const res = await skipsGet({ request: req('/api/admin/skips?min=1'), env: ENV });
    const body = (await res.json()) as { source: string; items: unknown; sampled: number };
    expect(body.source).toBe('sampled');
    expect(body.sampled).toBe(EVENTS.length);
    expect(body.items).toEqual(skipTable(EVENTS, 1));
    expect((body.items as Array<{ rate: number }>)[0].rate).toBe(50);
  });
});
