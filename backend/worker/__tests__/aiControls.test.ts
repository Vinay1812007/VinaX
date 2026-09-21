/**
 * 7.2.0 — owner AI controls, enforced on the backend: emergency stop,
 * per-feature switches and daily spend caps, read from vinax_config
 * `ai-controls` and cached per isolate. Real handlers, stubbed fetch (the
 * database REST surface and the model provider).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiControlsStatus, chat, gather, resetAiControlsCache, validateAiControls } from '../functions/_lib/ai';
import { onRequestPost as djPost } from '../functions/api/dj';
import { onRequestPost as playlistPost } from '../functions/api/playlist';
import { onRequestPost as curatePost } from '../functions/api/curate';
import { onRequestPost as vinaxaiPost } from '../functions/api/vinaxai';
import { onRequestPost as ttsPost } from '../functions/api/tts';
import { onRequestPost as imagePost } from '../functions/api/image';
import { onRequestPost as appconfigPost } from '../functions/api/admin/appconfig';
import { onRequestGet as dataqualityGet } from '../functions/api/admin/dataquality';
import { onRequestGet as ailabGet } from '../functions/api/admin/ailab';

const ENV = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  ADMIN_LOGIN_PASSWORD: 'test-secret',
  VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k-dj',
  VINAX_GROQ_API_KEY: 'k-scholar',
  VINAX_OAI_GPT_OSS_20B: 'k-fast',
};

interface World {
  controls?: unknown; // the stored ai-controls value (undefined = no row)
  prices?: unknown;
  configStatus?: number; // non-200 = the config read fails
  usage?: unknown[] | null; // RPC rows; null = RPC missing (404)
  usageStatus?: number;
  sample?: unknown[];
  answer?: unknown; // the model's JSON answer
}
const calls: Array<{ url: string; method: string; body: string | null }> = [];
let world: World = {};

function install(w: World): void {
  world = w;
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? String(init.body) : null });
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    if (url.startsWith('https://sb.test/rest/v1/vinax_config')) {
      if (method !== 'GET') return json([], 201);
      if (world.configStatus && world.configStatus !== 200) return json({ message: 'boom' }, world.configStatus);
      const rows: unknown[] = [];
      if (world.controls !== undefined) rows.push({ key: 'ai-controls', value: world.controls, updated_at: '2026-09-19T00:00:00Z' });
      if (world.prices !== undefined) rows.push({ key: 'ai-prices', value: world.prices });
      return json(rows);
    }
    if (url.startsWith('https://sb.test/rest/v1/rpc/vinax_ai_usage_since')) {
      if (world.usageStatus) return json({ message: 'boom' }, world.usageStatus);
      if (world.usage === null || world.usage === undefined) return json({ code: 'PGRST202' }, 404);
      return json(world.usage);
    }
    // usageStatus fails both usage paths (the rollup and the sample).
    if (url.startsWith('https://sb.test/rest/v1/vinax_ai_events') && method === 'GET') return world.usageStatus ? json({ message: 'boom' }, world.usageStatus) : json(world.sample ?? []);
    if (url.startsWith('https://sb.test/')) return json([], 201);
    // Anything else is a model provider.
    if (url.includes('audio/speech')) return Promise.resolve(new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    return json({ choices: [{ message: { content: JSON.stringify(world.answer ?? { ok: true }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  });
}
const providerCalls = () => calls.filter((c) => !c.url.startsWith('https://sb.test/'));
const configReads = () => calls.filter((c) => c.method === 'GET' && c.url.startsWith('https://sb.test/rest/v1/vinax_config'));

let ipSeq = 0;
function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  ipSeq += 1;
  return new Request(`https://www.sirimillavinay.online${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.40.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers },
    body: JSON.stringify(body),
  });
}
const pool = [{ id: 'p1', title: 'Orbit', artist: 'A' }, { id: 'p2', title: 'Comet', artist: 'B' }, { id: 'p3', title: 'Nova', artist: 'C' }];
const djAnswer = { intro: 'Here we go', songs: pool.map((p) => ({ songId: p.id, title: p.title, artist: p.artist, reason: 'fits', segue: '', confidence: 0.6, fromPool: true })) };
const dj = () => djPost({ request: post('/api/dj', { context: { seed: 'Orbit' }, pool, count: 3 }), env: ENV });
const playlist = () => playlistPost({ request: post('/api/playlist', { prompt: 'rainy evening' }), env: ENV });
const curate = (task: string, data: unknown) => curatePost({ request: post('/api/curate', { task, data }), env: ENV });
const errorOf = async (res: Response) => ((await res.clone().json()) as { error?: string }).error;

beforeEach(() => {
  resetAiControlsCache();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('validateAiControls — strict', () => {
  const now = new Date('2026-09-19T10:00:00Z');
  it('accepts a full record and stamps updatedAt from the server clock', () => {
    const r = validateAiControls({ emergencyOff: false, features: { dj: false, tts: true }, dailyTokenCap: 2_000_000, dailyCostCapUsd: 5.5, updatedAt: '1999-01-01' }, now);
    expect(r).toEqual({ ok: true, value: { emergencyOff: false, features: { dj: false, tts: true }, dailyTokenCap: 2_000_000, dailyCostCapUsd: 5.5, updatedAt: now.toISOString(), updatedBy: null } });
  });
  it('accepts the console\'s optional updatedBy, clipped, rather than rejecting the record', () => {
    const r = validateAiControls({ emergencyOff: false, updatedBy: `  Owner\u0000 ${'x'.repeat(200)}` }, now);
    expect(r.ok).toBe(true);
    const by = r.ok ? r.value.updatedBy : null;
    expect(by?.startsWith('Owner x')).toBe(true);
    expect(by).toHaveLength(80);
    expect(validateAiControls({ emergencyOff: false, updatedBy: 7 }, now)).toEqual({ ok: false, error: 'updatedBy_must_be_a_string' });
  });
  it.each([
    [null, 'not_an_object'],
    [[], 'not_an_object'],
    [{ features: {} }, 'emergencyOff_must_be_boolean'],
    [{ emergencyOff: 'yes' }, 'emergencyOff_must_be_boolean'],
    [{ emergencyOff: false, extra: 1 }, 'unknown_key:extra'],
    [{ emergencyOff: false, features: { chat: false } }, 'unknown_feature:chat'],
    [{ emergencyOff: false, features: { dj: 'off' } }, 'feature_must_be_boolean:dj'],
    [{ emergencyOff: false, features: [] }, 'features_must_be_an_object'],
    [{ emergencyOff: false, dailyTokenCap: -1 }, 'dailyTokenCap_must_be_a_whole_number_or_null'],
    [{ emergencyOff: false, dailyTokenCap: 10.5 }, 'dailyTokenCap_must_be_a_whole_number_or_null'],
    [{ emergencyOff: false, dailyTokenCap: '1000' }, 'dailyTokenCap_must_be_a_whole_number_or_null'],
    [{ emergencyOff: false, dailyCostCapUsd: Number.POSITIVE_INFINITY }, 'dailyCostCapUsd_must_be_a_number_or_null'],
    [{ emergencyOff: false, dailyCostCapUsd: 1e7 }, 'dailyCostCapUsd_must_be_a_number_or_null'],
  ])('refuses %j', (raw, error) => {
    expect(validateAiControls(raw, now)).toEqual({ ok: false, error });
  });
});

describe('publishing ai-controls through /api/admin/appconfig', () => {
  const admin = (value: unknown) =>
    appconfigPost({ request: post('/api/admin/appconfig', { key: 'ai-controls', value }, { 'x-admin-token': 'test-secret' }), env: ENV });

  it('an invalid record is refused with the reason and nothing is written', async () => {
    install({});
    const res = await admin({ emergencyOff: false, features: { everything: false } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_value', key: 'ai-controls', reason: 'unknown_feature:everything' });
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes('vinax_config'))).toHaveLength(0);
  });

  it('a valid record is stored normalised, with the server\'s updatedAt', async () => {
    install({});
    const res = await admin({ emergencyOff: true, features: { image: false }, dailyTokenCap: null, dailyCostCapUsd: 3 });
    expect(res.status).toBe(200);
    const write = calls.find((c) => c.method === 'POST' && c.url.includes('vinax_config'));
    const stored = JSON.parse(write?.body ?? '{}') as { key: string; value: Record<string, unknown> };
    expect(stored.key).toBe('ai-controls');
    expect(stored.value).toMatchObject({ emergencyOff: true, features: { image: false }, dailyTokenCap: null, dailyCostCapUsd: 3 });
    expect(typeof stored.value.updatedAt).toBe('string');
  });
});

describe('switching one feature off', () => {
  it('that route answers 503 ai_disabled without calling a provider; other routes still work', async () => {
    install({ controls: { emergencyOff: false, features: { dj: false } }, answer: djAnswer });
    const off = await dj();
    expect(off.status).toBe(503);
    expect(await errorOf(off)).toBe('ai_disabled');
    expect(providerCalls()).toHaveLength(0);

    install({ controls: { emergencyOff: false, features: { dj: false } }, answer: { name: 'Rain', description: 'd', songs: [{ title: 'Orbit', artist: 'A' }] } });
    const on = await playlist();
    expect(on.status).toBe(200);
    expect(providerCalls().length).toBeGreaterThan(0);
  });

  it('each curate task has its own switch', async () => {
    install({ controls: { emergencyOff: false, features: { 'curate-metadata': false } }, answer: { ids: ['s2', 's1'] } });
    const songs = [{ id: 's1', title: 'A' }, { id: 's2', title: 'B' }, { id: 's3', title: 'C' }];
    const meta = await curate('metadata', { songs });
    expect(meta.status).toBe(503);
    expect(await errorOf(meta)).toBe('ai_disabled');
    const ranking = await curate('ranking', { songs });
    expect(ranking.status).toBe(200);
  });

  it('chat() itself refuses a switched-off feature, and gather() spends nothing', async () => {
    install({ controls: { emergencyOff: false, features: { lyrics: false } } });
    const refused = await chat(ENV, [{ role: 'user', content: 'x' }], { lane: 'scholar', feature: 'lyrics' });
    expect(refused).toMatchObject({ content: null, error: 'disabled' });
    expect(await gather(ENV, [{ role: 'user', content: 'x' }], ['scholar', 'fast'], { feature: 'lyrics' })).toEqual([]);
    expect(providerCalls()).toHaveLength(0);
    const other = await chat(ENV, [{ role: 'user', content: 'x' }], { lane: 'scholar', feature: 'assistant' });
    expect(other.error).toBeUndefined();
    expect(providerCalls()).toHaveLength(1);
  });
});

describe('refusals are logged for the operations panel', () => {
  const aiRows = () =>
    calls.filter((c) => c.method === 'POST' && c.url === 'https://sb.test/rest/v1/vinax_ai_events').map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>);

  it('a switched-off feature leaves one ok:false row with error ai_disabled', async () => {
    install({ controls: { emergencyOff: false, features: { dj: false } } });
    await dj();
    expect(aiRows()).toEqual([{ feature: 'dj', model: null, ok: false, status: 503, error: 'ai_disabled', client: 'web', latency_ms: 0 }]);
  });

  it('a reached cap leaves error ai_over_budget, under the refusing feature\'s name', async () => {
    install({ controls: { emergencyOff: false, dailyTokenCap: 10 }, usage: [{ model: 'm1 @dj', calls: 1, prompt_tokens: 50, completion_tokens: 5, calls_without_usage: 0 }] });
    await curate('ranking', { songs: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
    await ttsPost({ request: post('/api/tts', { text: 'hi' }, { 'x-vinax-client': 'app' }), env: ENV });
    expect(aiRows().map((r) => [r.feature, r.error, r.client])).toEqual([
      ['curate-ranking', 'ai_over_budget', 'web'],
      ['tts', 'ai_over_budget', 'app'],
    ]);
  });

  it('refusal rows never count as spend, as AI failures, or as a lane', async () => {
    // Daily use: a refusal row carries no tokens and must not make the total "incomplete".
    install({ controls: { emergencyOff: false, dailyTokenCap: 1000 }, usage: null, sample: [
      { model: 'm1 @dj', prompt_tokens: 100, completion_tokens: 20, error: null },
      { model: null, prompt_tokens: null, completion_tokens: null, error: 'ai_disabled' },
    ] });
    const s = await aiControlsStatus(ENV);
    expect(s.usage).toMatchObject({ calls: 1, callsWithoutUsage: 0, tokensComplete: true });
    // Data quality: a refusal is not a failed AI call.
    install({});
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      const rows = url.includes('vinax_ai_events')
        ? [{ ok: true, error: null, model: 'm @dj', status: 200, latency_ms: 900 }, { ok: false, error: 'ai_disabled', model: null, status: 503, latency_ms: 0 }]
        : [{ origin_verified: true, country: 'IN' }];
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
    });
    const admin = (path: string) => new Request(`https://admin.test${path}`, { headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.41.0.${++ipSeq % 250}` } });
    const dq = (await (await dataqualityGet({ request: admin('/api/admin/dataquality'), env: ENV })).json()) as { metrics: { aiOkPct: number }; sampled: { aiEvents: number } };
    expect(dq.metrics.aiOkPct).toBe(100);
    expect(dq.sampled.aiEvents).toBe(1);
    const lab = (await (await ailabGet({ request: admin('/api/admin/ailab'), env: ENV })).json()) as { lanes: Array<{ lane: string }> };
    expect(lab.lanes.map((l) => l.lane)).not.toContain('unknown');
  });
});

describe('a feature is on unless its value is exactly false', () => {
  it('a stored non-boolean switch leaves the feature on', async () => {
    install({ controls: { emergencyOff: false, features: { dj: 'false', playlist: 0 } }, answer: djAnswer });
    expect((await dj()).status).toBe(200);
    const s = await aiControlsStatus(ENV);
    expect(s.features.dj).toBe(true);
    expect(s.features.playlist).toBe(true);
  });
});

describe('the emergency stop', () => {
  it('turns every AI route off, streaming ones included', async () => {
    install({ controls: { emergencyOff: true } });
    const chatRes = await vinaxaiPost({ request: post('/api/vinaxai', { messages: [{ role: 'user', content: 'hi' }] }), env: ENV });
    expect(chatRes.status).toBe(503);
    expect(await errorOf(chatRes)).toBe('ai_disabled');
    const tts = await ttsPost({ request: post('/api/tts', { text: 'hello' }), env: ENV });
    expect(tts.status).toBe(503);
    expect(await errorOf(tts)).toBe('ai_disabled');
    const img = await imagePost({ request: post('/api/image', { prompt: 'a cat' }), env: ENV });
    expect(img.status).toBe(503);
    expect(await errorOf(img)).toBe('ai_disabled');
    expect((await dj()).status).toBe(503);
    expect(providerCalls()).toHaveLength(0);
  });
});

describe('daily spend caps', () => {
  it('a reached token cap answers 503 ai_over_budget', async () => {
    install({ controls: { emergencyOff: false, dailyTokenCap: 1000 }, usage: [{ model: 'm1 @dj', calls: 3, prompt_tokens: 800, completion_tokens: 300, calls_without_usage: 0 }], answer: djAnswer });
    const res = await dj();
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe('ai_over_budget');
    expect(providerCalls()).toHaveLength(0);
  });

  it('under the cap the call goes through', async () => {
    install({ controls: { emergencyOff: false, dailyTokenCap: 1000 }, usage: [{ model: 'm1 @dj', calls: 1, prompt_tokens: 100, completion_tokens: 50, calls_without_usage: 0 }], answer: djAnswer });
    expect((await dj()).status).toBe(200);
  });

  it('a reached cost cap (priced models) answers 503 ai_over_budget', async () => {
    install({
      controls: { emergencyOff: false, dailyCostCapUsd: 0.5 },
      prices: { m1: { in: 1000, out: 1000 } }, // USD per million tokens
      usage: [{ model: 'm1 @dj', calls: 2, prompt_tokens: 800, completion_tokens: 300, calls_without_usage: 0 }], // $1.10
      answer: djAnswer,
    });
    const res = await dj();
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe('ai_over_budget');
  });

  it('unknown prices count as unknown, never zero: the estimate is a lower bound and the status says so', async () => {
    install({
      controls: { emergencyOff: false, dailyCostCapUsd: 0.5 },
      prices: { m1: { in: 100, out: 100 } },
      usage: [
        { model: 'm1 @dj', calls: 1, prompt_tokens: 1000, completion_tokens: 0, calls_without_usage: 0 }, // $0.10 known
        { model: 'mystery @fast', calls: 5, prompt_tokens: 90_000, completion_tokens: 10_000, calls_without_usage: 0 }, // unpriced
      ],
      answer: djAnswer,
    });
    expect((await dj()).status).toBe(200); // the known part ($0.10) is under the cap
    const status = await aiControlsStatus(ENV);
    expect(status.usage).toMatchObject({ costUsd: 0.1, costKnown: false, unpricedModels: ['mystery'], source: 'exact' });
    expect(status.caps.costUsd).toMatchObject({ cap: 0.5, used: 0.1, known: false, reached: false });
  });

  it('falls back to a bounded sample until the usage function is migrated', async () => {
    install({ controls: { emergencyOff: false, dailyTokenCap: 100 }, usage: null, sample: [{ model: 'm1 @dj', prompt_tokens: 90, completion_tokens: 20 }], answer: djAnswer });
    expect(await errorOf(await dj())).toBe('ai_over_budget');
    const sampleRead = calls.find((c) => c.method === 'GET' && c.url.includes('/rest/v1/vinax_ai_events'));
    expect(sampleRead?.url).toContain('limit=10000');
    expect((await aiControlsStatus(ENV)).usage?.source).toBe('sampled');
  });

  it('a failed usage read fails open (caps not enforced) and is reported', async () => {
    install({ controls: { emergencyOff: false, dailyTokenCap: 1 }, usageStatus: 500, answer: djAnswer });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await dj()).status).toBe(200);
    const status = await aiControlsStatus(ENV);
    expect(status.usage).toBeNull();
    expect(status.usageError).toBe('db_unavailable');
    warn.mockRestore();
  });
});

describe('a failed controls read fails open', () => {
  it('the route works as before, and the failure is logged', async () => {
    install({ configStatus: 500, answer: djAnswer });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await dj()).status).toBe(200);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[ai-controls] read failed (db_unavailable'))).toBe(true);
    const status = await aiControlsStatus(ENV);
    expect(status.source).toBe('unavailable');
    expect(status.readError).toBe('db_unavailable');
    warn.mockRestore();
  });

  it('except a cached emergency stop, which keeps applying until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
    install({ controls: { emergencyOff: true }, answer: djAnswer });
    expect(await errorOf(await dj())).toBe('ai_disabled');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 35 s later the refresh fails: the stop read 35 s ago still holds.
    world.configStatus = 500;
    vi.setSystemTime(new Date('2026-09-19T10:00:35Z'));
    expect(await errorOf(await dj())).toBe('ai_disabled');
    // Past 60 s after the last good read, a still-failing read fails open.
    vi.setSystemTime(new Date('2026-09-19T10:01:01Z'));
    expect((await dj()).status).toBe(200);
    warn.mockRestore();
  });

  it('controls are cached per isolate: one read serves many calls within the refresh period', async () => {
    install({ controls: { emergencyOff: false } });
    for (let i = 0; i < 5; i += 1) await chat(ENV, [{ role: 'user', content: 'x' }], { lane: 'scholar' });
    expect(configReads()).toHaveLength(1);
  });

  it('an unconfigured database reads nothing and blocks nothing', async () => {
    install({});
    const env = { VINAX_GROQ_API_KEY: 'k' };
    const r = await chat(env, [{ role: 'user', content: 'x' }], { lane: 'scholar', feature: 'dj' });
    expect(r.error).toBeUndefined();
    expect(calls.filter((c) => c.url.startsWith('https://sb.test/'))).toHaveLength(0);
  });
});

describe('aiControlsStatus — the contract the console panel reads', () => {
  it('reports controls, effective features, observed use and each cap', async () => {
    install({
      controls: { emergencyOff: false, features: { tts: false }, dailyTokenCap: 10_000, dailyCostCapUsd: 2, updatedAt: '2026-09-19T08:00:00.000Z' },
      prices: { m1: { in: 1, out: 2 } },
      usage: [{ model: 'm1 @dj', calls: 4, prompt_tokens: 3000, completion_tokens: 1000, calls_without_usage: 1 }],
    });
    const s = await aiControlsStatus(ENV);
    expect(s).toMatchObject({
      configured: true,
      source: 'published',
      readError: null,
      controls: { emergencyOff: false, features: { tts: false }, dailyTokenCap: 10_000, dailyCostCapUsd: 2, updatedAt: '2026-09-19T08:00:00.000Z' },
      usage: { source: 'exact', truncated: false, calls: 4, callsWithoutUsage: 1, tokens: { prompt: 3000, completion: 1000, total: 4000 }, tokensComplete: false, costUsd: 0.005, costKnown: false, unpricedModels: [] },
      caps: {
        tokens: { cap: 10_000, used: 4000, remaining: 6000, reached: false, complete: false },
        costUsd: { cap: 2, used: 0.005, remaining: 1.995, reached: false, known: false },
      },
      blocked: { emergency: false, overBudget: false, disabledFeatures: ['tts'] },
      cache: { controlsRefreshSec: 30, emergencyMaxAgeSec: 60, usageRefreshSec: 60 },
    });
    expect(s.features.tts).toBe(false);
    expect(s.features.dj).toBe(true);
    expect(s.usage?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
