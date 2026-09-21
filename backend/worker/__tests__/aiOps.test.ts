import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateAiOps, budgetView, laneOf, onRequestGet, parseAiControls, AI_CONTROL_FEATURES, type AiOpsRow } from '../functions/api/admin/aiops';
import { parsePrices } from '../functions/api/admin/aicost';

/**
 * AI operations: per-feature and per-lane health, token use and cost, set
 * against the owner's published `ai-controls`. A cost the price table cannot
 * explain is UNKNOWN — never a zero that reads as "free".
 */

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let ipSeq = 0;
const req = (qs = 'days=7', token = 'test-secret'): Request => {
  ipSeq += 1;
  return new Request(`https://admin.test/api/admin/aiops?${qs}`, { headers: { 'x-admin-token': token, 'cf-connecting-ip': `10.22.0.${ipSeq % 250}` } });
};

const NOW = new Date('2026-09-19T12:00:00Z');
const row = (o: Partial<AiOpsRow>): AiOpsRow => ({
  created_at: '2026-09-19T08:00:00Z', feature: 'dj', model: 'alpha-large @dj', ok: true, status: 200, error: null, latency_ms: 1000,
  prompt_tokens: 1000, completion_tokens: 500, ...o,
});

describe('aggregateAiOps', () => {
  const prices = parsePrices({ 'alpha-': { in: 1, out: 2 } });
  const rows = [
    row({}),
    row({ latency_ms: 3000 }),
    row({ ok: false, status: 502, error: 'engine_fallback_502', latency_ms: 11000, prompt_tokens: null, completion_tokens: null }),
    row({ feature: 'playlist', model: 'beta-small @fast', created_at: '2026-09-18T08:00:00Z' }),
    row({ feature: 'assistant', model: 'alpha-large @scholar', ok: false, status: 503, error: 'ai_disabled', latency_ms: 2 }),
  ];
  const r = aggregateAiOps(rows, prices, NOW);

  it('groups by feature and by the lane in the model label', () => {
    expect(laneOf('alpha-large @vision90')).toBe('vision90');
    expect(laneOf('exception')).toBe('(none)');
    expect(r.byFeature.map((g) => [g.key, g.calls])).toEqual([['dj', 3], ['playlist', 1], ['assistant', 1]]);
    expect(r.byLane.map((g) => g.key).sort()).toEqual(['dj', 'fast', 'scholar']);
  });

  it('reports failure rate with its interval, latency percentiles, hops and refusals', () => {
    const dj = r.byFeature.find((g) => g.key === 'dj')!;
    expect(dj.failureRate).toMatchObject({ k: 1, n: 3 });
    expect(dj.failureRate.low!).toBeLessThan(0.1);
    expect(dj.latencyMs).toEqual({ n: 3, p50: 3000, p95: 11000 });
    expect(dj.hops).toBe(1);
    expect(r.byFeature.find((g) => g.key === 'assistant')!.blocked).toEqual({ disabled: 1, overBudget: 0 });
  });

  it('prices known models and marks the rest unknown, never zero', () => {
    const dj = r.byFeature.find((g) => g.key === 'dj')!;
    expect(dj.tokens).toEqual({ prompt: 2000, completion: 1000, reportedCalls: 2 });
    expect(dj.cost).toEqual({ usd: 0.004, pricedCalls: 2, unpricedCalls: 0, unreportedCalls: 1, complete: false });
    const playlist = r.byFeature.find((g) => g.key === 'playlist')!;
    expect(playlist.cost.usd).toBeNull(); // beta-small has no price
    expect(playlist.cost).toMatchObject({ unpricedCalls: 1, complete: false });
    const noTable = aggregateAiOps(rows, null, NOW);
    expect(noTable.totals.cost.usd).toBeNull();
  });

  it('adds up today (UTC) separately', () => {
    expect(r.today.day).toBe('2026-09-19');
    expect(r.today.calls).toBe(4);
    expect(r.today.tokens).toBe(4500);
  });
});

describe('ai-controls and the budget', () => {
  it('parses the published value: features on unless exactly false, caps non-negative', () => {
    const c = parseAiControls({ emergencyOff: 'yes', features: { dj: false, tts: 0 }, dailyTokenCap: -1, dailyCostCapUsd: 2.5, updatedAt: '2026-09-19T10:00:00Z', updatedBy: '  ops  ' })!;
    expect(c.emergencyOff).toBe(false);
    expect(c.features.dj).toBe(false);
    expect(c.features.tts).toBe(true);
    expect(Object.keys(c.features)).toEqual([...AI_CONTROL_FEATURES]);
    expect(c.dailyTokenCap).toBeNull();
    expect(c.dailyCostCapUsd).toBe(2.5);
    expect(c.updatedBy).toBe('ops');
    expect(parseAiControls(null)).toBeNull();
  });

  it('sets caps against today and refuses to call an unknown cost "within budget"', () => {
    const today = { day: '2026-09-19', calls: 10, tokens: 9000, cost: { usd: 0.5, pricedCalls: 8, unpricedCalls: 2, unreportedCalls: 0, complete: false } };
    const base = parseAiControls({})!;
    expect(budgetView(base, true, today).state).toBe('no_caps');
    expect(budgetView({ ...base, dailyTokenCap: 8000 }, true, today)).toMatchObject({ state: 'over_tokens', tokenPct: 113 });
    expect(budgetView({ ...base, dailyCostCapUsd: 0.4 }, true, today).state).toBe('over_cost');
    expect(budgetView({ ...base, dailyCostCapUsd: 5 }, true, today)).toMatchObject({ state: 'cost_unknown', costPct: 10 });
    expect(budgetView(null, false, today).state).toBe('controls_unknown');
  });
});

describe('GET /api/admin/aiops', () => {
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

  it('refuses a wrong token before touching the database', async () => {
    stub(() => new Response('[]'));
    expect((await onRequestGet({ request: req('days=7', 'nope'), env: ENV })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('a failed events read is a 502, never zeros', async () => {
    stub((url) => (url.includes('vinax_ai_events') ? new Response('{}', { status: 503 }) : new Response('[]')));
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('db_unavailable');
    expect(body.totals).toBeUndefined();
  });

  it('falls back to the bare columns when the token columns are not migrated yet', async () => {
    stub((url) => {
      if (url.includes('vinax_ai_events') && url.includes('prompt_tokens')) return new Response('{}', { status: 400 });
      if (url.includes('vinax_ai_events')) return new Response(JSON.stringify([{ created_at: new Date().toISOString(), feature: 'dj', model: 'm @dj', ok: true, status: 200, error: null, latency_ms: 900 }]));
      return new Response('[]');
    });
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokenColumns: boolean; totals: { calls: number; cost: { usd: number | null } } };
    expect(body.tokenColumns).toBe(false);
    expect(body.totals.calls).toBe(1);
    expect(body.totals.cost.usd).toBeNull();
  });

  it('shows the published controls with who and when, and marks them unknown when the config read fails', async () => {
    const controls = { emergencyOff: true, features: { dj: false }, dailyTokenCap: 100000, dailyCostCapUsd: null, updatedAt: '2026-09-19T09:00:00Z', updatedBy: 'ops' };
    stub((url) => (url.includes('vinax_config') ? new Response(JSON.stringify([{ key: 'ai-controls', value: controls, updated_at: '2026-09-19T09:00:01Z' }])) : new Response('[]')));
    const ok = (await (await onRequestGet({ request: req(), env: ENV })).json()) as { controls: { read: string; published: boolean; value: { emergencyOff: boolean; updatedBy: string } }; budget: { state: string } };
    expect(ok.controls).toMatchObject({ read: 'ok', published: true, value: { emergencyOff: true, updatedBy: 'ops' } });
    expect(ok.budget.state).toBe('within');

    stub((url) => (url.includes('vinax_config') ? new Response('{}', { status: 500 }) : new Response('[]')));
    const failed = (await (await onRequestGet({ request: req(), env: ENV })).json()) as { controls: { read: string; error: string }; budget: { state: string }; prices: { configured: boolean | null } };
    expect(failed.controls).toMatchObject({ read: 'failed', error: 'db_unavailable' });
    expect(failed.budget.state).toBe('controls_unknown');
    expect(failed.prices.configured).toBeNull();
  });
});
