/** 14.0 — the owner's AI controls: emergency stop, per-feature switches, the daily token cap. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiRefusal, featureName, parseAiControls, resetAiControlsMemo } from '../functions/_lib/aiControls';
import { resetSettingsMemo } from '../functions/_lib/settings';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
function stub(controls: unknown, usage: unknown[] = []): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => {
    const url = String(u);
    calls.push(url);
    if (url.includes('/rpc/ai_usage_since')) return new Response(JSON.stringify(usage), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(controls === undefined ? [] : [{ key: 'ai-controls', value: controls, updated_at: 'x', updated_by: 'owner' }]), { headers: { 'content-type': 'application/json' } });
  }));
  return { calls };
}
beforeEach(() => { resetSettingsMemo(); resetAiControlsMemo(); });
afterEach(() => vi.unstubAllGlobals());

describe('AI controls', () => {
  it('parses loosely and ignores junk', () => {
    expect(parseAiControls(null)).toEqual({ emergencyOff: false, features: {}, dailyTokenCap: null });
    expect(parseAiControls({ emergencyOff: 'yes', features: { chat: false, 'bad key!': false, dj: 'no' }, dailyTokenCap: 1e6 })).toEqual({ emergencyOff: false, features: { chat: false }, dailyTokenCap: 1_000_000 });
    expect(featureName('chat:expert')).toBe('chat');
  });

  it('allows everything without a database or a setting', async () => {
    expect(await aiRefusal({}, 'chat')).toBeNull();
    stub(undefined);
    expect(await aiRefusal(ENV, 'chat')).toBeNull();
  });

  it('the emergency stop and a feature switch refuse with ai_disabled', async () => {
    stub({ emergencyOff: true });
    expect(await aiRefusal(ENV, 'dj')).toBe('ai_disabled');
    resetSettingsMemo();
    stub({ features: { chat: false } });
    expect(await aiRefusal(ENV, 'chat:expert')).toBe('ai_disabled');
    expect(await aiRefusal(ENV, 'dj')).toBeNull();
  });

  it('the daily token cap refuses once today\'s tokens reach it, reading usage once a minute', async () => {
    const { calls } = stub({ dailyTokenCap: 1000 }, [{ model: 'm', promptTokens: 600, completionTokens: 500 }]);
    expect(await aiRefusal(ENV, 'chat')).toBe('ai_over_budget');
    expect(await aiRefusal(ENV, 'chat')).toBe('ai_over_budget');
    expect(calls.filter((u) => u.includes('ai_usage_since')).length).toBe(1);
    resetAiControlsMemo();
    resetSettingsMemo();
    stub({ dailyTokenCap: 5000 }, [{ model: 'm', promptTokens: 600, completionTokens: 500 }]);
    expect(await aiRefusal(ENV, 'chat')).toBeNull();
  });
});
