/** v5.16.0 — AI Cost panel: operator prices × logged token counts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiCost, costUsd, matchPrice, modelSlug, parsePrices, onRequestGet } from '../functions/api/admin/aicost';
import { resetConfigMemo } from '../functions/_lib/clientConfig';
import { ALLOWED_KEYS } from '../functions/api/admin/appconfig';

describe('price table', () => {
  it('keeps only well-formed {in,out} entries', () => {
    expect(parsePrices({ 'nvidia/': { in: 0.2, out: 0.6 }, bad: { in: 'x' }, neg: { in: -1, out: 1 }, ' spaced ': { in: 0, out: 0 } })).toEqual({
      'nvidia/': { in: 0.2, out: 0.6 },
      spaced: { in: 0, out: 0 },
    });
    expect(parsePrices(null)).toEqual({});
    expect(parsePrices([1])).toEqual({});
  });

  it('matches the longest prefix, exact slug first', () => {
    const prices = parsePrices({
      'nvidia/': { in: 1, out: 1 },
      'nvidia/nemotron-3': { in: 2, out: 2 },
      'nvidia/nemotron-3-super-120b-a12b': { in: 3, out: 3 },
    });
    expect(matchPrice('nvidia/nemotron-3-super-120b-a12b', prices)).toEqual({ in: 3, out: 3 });
    expect(matchPrice('nvidia/nemotron-3-nano-30b-a3b', prices)).toEqual({ in: 2, out: 2 });
    expect(matchPrice('nvidia/llama-3.3-nemotron-super-49b-v1.5', prices)).toEqual({ in: 1, out: 1 });
    expect(matchPrice('llama-3.3-70b-versatile', prices)).toBeNull();
  });

  it('strips the lane suffix the event log appends', () => {
    expect(modelSlug('nvidia/nemotron-3-nano-30b-a3b @search')).toBe('nvidia/nemotron-3-nano-30b-a3b');
    expect(modelSlug('exception')).toBe('exception');
    expect(modelSlug(null)).toBe('(none)');
  });

  it('costs tokens per million, in micro-dollars', () => {
    expect(costUsd(1_000_000, 0, { in: 0.5, out: 2 })).toBe(0.5);
    expect(costUsd(500_000, 250_000, { in: 0.4, out: 1.6 })).toBe(0.6);
    expect(costUsd(1234, 567, { in: 0.15, out: 0.6 })).toBe(0.000525);
    expect(costUsd(1e6, 1e6, null)).toBe(0);
  });
});

describe('aiCost report', () => {
  const rows = [
    { created_at: '2026-09-07T10:00:00Z', feature: 'assistant', model: 'nvidia/nemotron-3-nano-30b-a3b @search', prompt_tokens: 1000, completion_tokens: 500 },
    { created_at: '2026-09-07T11:00:00Z', feature: 'dj', model: 'nvidia/nemotron-3-nano-30b-a3b @dj', prompt_tokens: 3000, completion_tokens: 1500 },
    { created_at: '2026-09-08T09:00:00Z', feature: 'lyrics', model: 'llama-3.3-70b-versatile @scholar', prompt_tokens: 200, completion_tokens: 100 },
    { created_at: '2026-09-08T09:30:00Z', feature: 'home', model: 'openai/gpt-oss-20b @home', prompt_tokens: null, completion_tokens: null }, // pre-migration row
  ];

  it('totals tokens, groups by slug and by day, prices what it can', () => {
    const r = aiCost(rows, parsePrices({ 'nvidia/': { in: 1, out: 2 } }));
    expect(r.tokensTotal).toEqual({ prompt: 4200, completion: 2100 });
    expect(r.byModel[0]).toEqual({ model: 'nvidia/nemotron-3-nano-30b-a3b', calls: 2, prompt: 4000, completion: 2000, cost: 0.008, priced: true });
    expect(r.byModel.find((m) => m.model === 'llama-3.3-70b-versatile')).toEqual({ model: 'llama-3.3-70b-versatile', calls: 1, prompt: 200, completion: 100, cost: 0, priced: false });
    expect(r.byModel.find((m) => m.model === 'openai/gpt-oss-20b')?.calls).toBe(1);
    expect(r.byDay).toEqual([
      { day: '2026-09-07', prompt: 4000, completion: 2000, cost: 0.008 },
      { day: '2026-09-08', prompt: 200, completion: 100, cost: 0 },
    ]);
    expect(r.unpriced).toBe(false);
  });

  it('flags unpriced when no price table or nothing matches', () => {
    expect(aiCost(rows, {}).unpriced).toBe(true);
    expect(aiCost(rows, parsePrices({ 'other/': { in: 1, out: 1 } })).unpriced).toBe(true);
    expect(aiCost(rows, {}).byModel.every((m) => m.cost === 0)).toBe(true);
  });
});

describe('GET /api/admin/aicost', () => {
  const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
  const calls: string[] = [];
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetConfigMemo();
    calls.length = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('vinax_config')) {
        return Promise.resolve(new Response(JSON.stringify([{ key: 'ai-prices', value: { 'nvidia/': { in: 1, out: 2 } } }]), { status: 200 }));
      }
      if (url.includes('vinax_ai_events')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ created_at: '2026-09-08T01:00:00Z', feature: 'dj', model: 'nvidia/x @dj', prompt_tokens: 1_000_000, completion_tokens: 0 }]), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is admin-gated', async () => {
    const res = await onRequestGet({ request: new Request('https://admin.test/api/admin/aicost'), env: ENV });
    expect(res.status).toBe(401);
  });

  it('reads the price table from config and the newest 20k events', async () => {
    const request = new Request('https://admin.test/api/admin/aicost?days=7', { headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '10.6.0.1' } });
    const res = await onRequestGet({ request, env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.days).toBe(7);
    expect(body.sampled).toBe(1);
    expect(body.prices).toEqual({ 'nvidia/': { in: 1, out: 2 } });
    expect(body.unpriced).toBe(false);
    expect(body.tokensTotal).toEqual({ prompt: 1_000_000, completion: 0 });
    expect((body.byModel as Array<{ cost: number }>)[0].cost).toBe(1);
    const ev = calls.find((u) => u.includes('vinax_ai_events')) ?? '';
    expect(ev).toContain('select=created_at,feature,model,prompt_tokens,completion_tokens');
    expect(ev).toContain('order=created_at.desc&limit=20000');
  });

  it('the price key is publishable from the console', () => {
    expect(ALLOWED_KEYS.has('ai-prices')).toBe(true);
  });
});
