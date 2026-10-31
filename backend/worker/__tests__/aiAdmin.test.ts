/**
 * Owner console — the VinaX AI providers card (GET/POST /api/admin/ai):
 * owner-only; which keys are set (never their values), what is resting and
 * the last error per provider; the owner's model switches; today's search
 * allowances; voice; and the manual probe, which rests a failing model and
 * ends the rest of one that answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from '../functions/api/admin/ai';
import { _resetCooldowns, isCooling, noteFailure } from '../functions/_lib/ai/cooldown';
import { ProviderError } from '../functions/_lib/ai/errors';
import { MODELS, modelById, UTILITY_MODELS } from '../functions/_lib/ai/models';
import { _resetVoiceRests, noteVoiceFailure } from '../functions/_lib/ai/voice';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, sseResponse } from './helpers/aiStreams';

const ENV = { ADMIN_LOGIN_PASSWORD: 'owner-pass', GROQ_API_KEY: 'gsk-secret-value', GEMINI_API_KEY: 'gem-secret-value', SEARCH_API_KEY: 'tvly-secret', ...DB_ENV };
const GROQ = 'groq:openai/gpt-oss-120b';
let ip = 0;

const req = (init: { method?: string; body?: unknown; token?: string | null } = {}) => new Request('https://www.vinaxmusic.online/api/admin/ai', {
  method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
  headers: { 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(init.token === null ? {} : { 'x-admin-token': init.token ?? 'owner-pass' }), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
});

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetCooldowns();
  _resetVoiceRests();
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/admin/ai', () => {
  it('is for the owner only', async () => {
    fakeDb({});
    expect((await onRequestGet({ request: req({ token: null }), env: ENV })).status).toBe(401);
    expect((await onRequestGet({ request: req({ token: 'wrong' }), env: ENV })).status).toBe(401);
  });

  it('shows keys as set or missing, rests, last errors, switches, allowances and voice — never a key', async () => {
    const today = new Date().toISOString().slice(0, 10);
    fakeDb({
      settings: [{ key: 'vinax-ai', value: { enabled: false, testers: ['1001'], search: true, models: { [GROQ]: { enabled: false } } }, updated_at: 'x', updated_by: 'owner' }],
      ai_daily_usage: [{ day: today, kind: 'grounding', count: 12 }, { day: today, kind: 'search', count: 3 }],
    });
    noteFailure(modelById(MODELS, 'gemini:gemini-3.6-flash')!, new ProviderError('rate', { status: 429, retryAfterMs: 30_000 }));
    noteVoiceFailure('canopylabs/orpheus-v1-english', new ProviderError('quota', { status: 429 }));
    const res = await onRequestGet({ request: req(), env: ENV });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/secret-value|tvly-secret|service-role/);
    const body = JSON.parse(text);
    expect(body.settings).toEqual({ enabled: false, testers: ['1001'], search: true, overrides: 1 });
    const byId = Object.fromEntries(body.providers.map((p: { id: string }) => [p.id, p]));
    expect(byId.groq).toMatchObject({ name: 'Groq', configured: true, lastError: null });
    expect(byId.nvidia.configured).toBe(false);
    expect(byId.gemini.lastError).toMatchObject({ kind: 'rate', status: 429 });
    const gem = body.models.find((m: { id: string }) => m.id === 'gemini:gemini-3.6-flash');
    expect(gem).toMatchObject({ configured: true, restKind: 'rate', ownerEnabled: true });
    expect(Date.parse(gem.restingUntil)).toBeGreaterThan(Date.now());
    expect(body.models.find((m: { id: string }) => m.id === GROQ).ownerEnabled).toBe(false);
    expect(body.models).toHaveLength(MODELS.length);
    expect(body.search.api).toMatchObject({ configured: true, provider: 'tavily', usedToday: 3 });
    expect(body.search.grounding).toMatchObject({ configured: true, dailyLimit: 450, usedToday: 12 });
    expect(body.voice).toMatchObject({ dictation: true, readAloud: true, live: true });
    expect(body.voice.resting.map((r: { model: string }) => r.model)).toEqual(['canopylabs/orpheus-v1-english']);
    expect(body.utility).toHaveLength(UTILITY_MODELS.length);
    expect(body.utility.find((x: { id: string }) => x.id === 'nvidia:meta/llama-guard-4-12b')).toEqual({ id: 'nvidia:meta/llama-guard-4-12b', name: 'Llama Guard 4 12B', provider: 'NVIDIA', kind: 'guard', configured: false });
  });
});

describe('POST /api/admin/ai (the probe)', () => {
  it('a model that answers: OK with its times, and its rest ends', async () => {
    fakeDb({}, (url) => (url.includes('api.groq.com') ? sseResponse(openAiSse('OK')) : new Response('', { status: 500 })));
    const spec = modelById(MODELS, GROQ)!;
    noteFailure(spec, new ProviderError('rate', { status: 429 }));
    expect(isCooling(spec)).toBe(true);
    const res = await onRequestPost({ request: req({ body: { model: GROQ } }), env: ENV });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ model: GROQ, ok: true });
    expect(typeof body.firstTokenMs).toBe('number');
    expect(isCooling(spec)).toBe(false);
  });

  it('a model that fails: the reason, never the provider’s words, and it rests', async () => {
    fakeDb({}, () => new Response(JSON.stringify({ error: { message: 'secret upstream words' } }), { status: 429, headers: { 'retry-after': '20' } }));
    const res = await onRequestPost({ request: req({ body: { model: GROQ } }), env: ENV });
    const text = await res.text();
    expect(text).not.toContain('secret upstream words');
    expect(JSON.parse(text)).toMatchObject({ model: GROQ, ok: false, kind: 'rate', status: 429 });
    expect(isCooling(modelById(MODELS, GROQ)!)).toBe(true);
  });

  it('a provider without a key is reported, not called; unknown models and strangers are refused', async () => {
    const db = fakeDb({});
    const nv = MODELS.find((m) => m.provider === 'nvidia')!;
    const res = await onRequestPost({ request: req({ body: { model: nv.id } }), env: ENV });
    expect(await res.json()).toMatchObject({ ok: false, kind: 'not_configured' });
    expect(db.other).toHaveLength(0);
    expect((await onRequestPost({ request: req({ body: { model: 'nope' } }), env: ENV })).status).toBe(400);
    expect((await onRequestPost({ request: req({ body: { model: GROQ }, token: null }), env: ENV })).status).toBe(401);
  });
});
