import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REC_WEIGHT_DEFAULTS,
  publicClientConfig,
  publicRecConfig,
  recWeightBounds,
  resetConfigMemo,
  withRolloutSplit,
} from '../functions/_lib/clientConfig';
import { ALLOWED_KEYS } from '../functions/api/admin/appconfig';
import { onRequestGet as publicAppconfigGet } from '../functions/api/appconfig';
import {
  HISTORY_LIMIT,
  REC_WEIGHT_TERMS,
  onRequestGet,
  onRequestPost,
  parseHistory,
  validateRecConfigInput,
  type ExperimentInfo,
  type RecConfigRecord,
} from '../functions/api/admin/recconfig';

/**
 * Recommendation Tuning: a versioned, bounded override of the scorer's
 * weights. Pinned here: the Worker's weight table is the app's weight table,
 * validation rejects what it does not know and clamps what it does, a stale
 * editor gets 409 instead of overwriting, rollback is a new version, and only
 * the sanitised override reaches the public bundle.
 */

const root = (rel: string): string => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

describe('the weight table is the app\'s weight table', () => {
  it('REC_WEIGHT_DEFAULTS equals DEFAULT_WEIGHTS in frontend/src/services/recommendation/weights.ts', () => {
    const src = readFileSync(root('frontend/src/services/recommendation/weights.ts'), 'utf8');
    const start = src.indexOf('const DEFAULT_WEIGHTS = Object.freeze({');
    const end = src.indexOf('} as const);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const app: Record<string, number> = {};
    for (const m of src.slice(start, end).matchAll(/^\s*([A-Za-z]+):\s*([0-9.]+),?\s*$/gm)) app[m[1]] = Number(m[2]);
    expect(Object.keys(app).length).toBeGreaterThan(20);
    expect(app).toEqual({ ...REC_WEIGHT_DEFAULTS });
    expect(src).toContain("SCORING_WEIGHTS_VERSION = '1.2.0'");
  });

  it('every weight says what it touches, and the ranges are half … double the default', () => {
    for (const key of Object.keys(REC_WEIGHT_DEFAULTS) as Array<keyof typeof REC_WEIGHT_DEFAULTS>) {
      const t = REC_WEIGHT_TERMS[key];
      expect(t, key).toBeDefined();
      expect(t.touches.length > 0 || !!t.note, key).toBe(true);
      expect(recWeightBounds(key)).toEqual({ min: Math.round(REC_WEIGHT_DEFAULTS[key] * 0.5 * 1e4) / 1e4, max: Math.round(REC_WEIGHT_DEFAULTS[key] * 2 * 1e4) / 1e4 });
    }
  });

  it('rec-config is NOT writable through the generic appconfig route (it would skip validation and versioning)', () => {
    expect(ALLOWED_KEYS.has('rec-config')).toBe(false);
    expect(ALLOWED_KEYS.has('rec-config-history')).toBe(false);
  });
});

describe('validateRecConfigInput', () => {
  const exps: ExperimentInfo[] = [{ key: 'rec-weights', name: 'Weights', active: true, variants: [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }] }];

  it('rejects unknown keys and non-numbers — nothing is silently dropped', () => {
    const v = validateRecConfigInput({ overrides: { mood: 0.2, moood: 0.2, likes: '0.1' }, rollout: { mode: 'all' } }, exps);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems.map((p) => p.field).sort()).toEqual(['overrides.likes', 'overrides.moood']);
  });

  it('clamps out-of-range values into the safe range and reports each clamp', () => {
    const v = validateRecConfigInput({ overrides: { mood: 5, diversity: 0.01, tempo: 0.1 }, rollout: { mode: 'all' } }, exps);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.overrides).toEqual({ mood: 0.32, diversity: 0.1, tempo: 0.1 });
    expect(v.clamped).toEqual([{ key: 'mood', requested: 5, applied: 0.32 }, { key: 'diversity', requested: 0.01, applied: 0.1 }]);
  });

  it('checks the rollout against real experiments and variants', () => {
    expect(validateRecConfigInput({ overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant: 'treatment' } }, exps).ok).toBe(true);
    const noExp = validateRecConfigInput({ overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'nope', variant: 'treatment' } }, exps);
    expect(noExp.ok ? [] : noExp.problems.map((p) => p.problem)).toEqual(['no such experiment']);
    const noVar = validateRecConfigInput({ overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant: 'b' } }, exps);
    expect(noVar.ok).toBe(false);
    expect(validateRecConfigInput({ overrides: { mood: 0.2 }, rollout: { mode: 'sometimes' } }, exps).ok).toBe(false);
    expect(validateRecConfigInput({ overrides: {}, rollout: { mode: 'all' } }, exps).ok).toBe(false);
    expect(validateRecConfigInput({ overrides: {}, rollout: { mode: 'off' } }, exps).ok).toBe(true);
  });

  it('accepts an evaluation only with a summary and an https link', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    const good = validateRecConfigInput({ overrides: { mood: 0.2 }, rollout: { mode: 'off' }, evaluation: { summary: 'offline replay, 500 sessions', url: 'https://example.test/run/1' } }, exps, now);
    expect(good.ok && good.evaluation).toEqual({ summary: 'offline replay, 500 sessions', url: 'https://example.test/run/1', at: '2026-09-19T10:00:00.000Z' });
    expect(validateRecConfigInput({ overrides: {}, rollout: { mode: 'off' }, evaluation: { summary: 'x', url: 'javascript:alert(1)' } }, exps).ok).toBe(false);
    expect(validateRecConfigInput({ overrides: {}, rollout: { mode: 'off' }, evaluation: { url: 'https://x.test' } }, exps).ok).toBe(false);
  });
});

describe('the public bundle', () => {
  it('ships only version, clamped known overrides and the rollout; nothing while off', () => {
    const rec = { version: 4, overrides: { mood: 9, bogus: 1 }, rollout: { mode: 'all' }, note: 'secret plan', evaluation: { summary: 's', url: 'https://x.test', at: '' }, updatedBy: 'ops' };
    expect(publicRecConfig(rec)).toEqual({ version: 4, overrides: { mood: 0.32 }, rollout: { mode: 'all' } });
    expect(publicRecConfig({ ...rec, rollout: { mode: 'off' } })).toBeNull();
    expect(publicRecConfig({ ...rec, overrides: { bogus: 1 } })).toBeNull();
    expect(publicRecConfig({ ...rec, version: 0 })).toBeNull();
    expect(publicRecConfig({ ...rec, rollout: { mode: 'experiment', experimentKey: '<b>', variant: 'x' } })).toBeNull();
    const cfg = publicClientConfig({ 'rec-config': rec });
    expect(cfg.recConfig).toEqual({ version: 4, overrides: { mood: 0.32 }, rollout: { mode: 'all' } });
    expect(JSON.stringify(cfg)).not.toContain('secret plan');
    expect('recConfig' in publicClientConfig({})).toBe(false);
  });

  it('an experiment rollout ships the live split, and is withheld while the experiment is paused', async () => {
    resetConfigMemo();
    const staged = { version: 2, overrides: { mood: 0.2 }, rollout: { mode: 'experiment' as const, experimentKey: 'rec-weights', variant: 'treatment' } };
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify([{ variants: [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }] }]))));
    expect(await withRolloutSplit(ENV, staged)).toEqual({ ...staged, rollout: { ...staged.rollout, variants: [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }] } });
    resetConfigMemo();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('[]'))); // active=eq.true matched nothing: paused
    expect(await withRolloutSplit(ENV, staged)).toBeNull();
    vi.unstubAllGlobals();
    resetConfigMemo();
  });

  it('GET /api/appconfig?key=client carries recConfig', async () => {
    resetConfigMemo();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      if (url.includes('vinax_config')) {
        expect(url).toContain('"rec-config"');
        return Promise.resolve(new Response(JSON.stringify([{ key: 'rec-config', value: { version: 3, overrides: { likes: 0.15 }, rollout: { mode: 'all' } } }])));
      }
      return Promise.resolve(new Response('[]'));
    });
    const res = await publicAppconfigGet({ request: new Request('https://x.test/api/appconfig?key=client'), env: ENV });
    const body = (await res.json()) as { recConfig?: unknown };
    expect(body.recConfig).toEqual({ version: 3, overrides: { likes: 0.15 }, rollout: { mode: 'all' } });
    vi.unstubAllGlobals();
    resetConfigMemo();
  });
});

// ---- the admin route, against an in-memory PostgREST ------------------------------

interface Db { config: Map<string, { value: unknown; updated_at: string }>; experiments: Array<{ key: string; name: string; active: boolean; variants: unknown; created_at: string }>; writes: string[] }
let db: Db;
let ipSeq = 0;

function installDb(): void {
  db = { config: new Map(), experiments: [{ key: 'rec-weights', name: 'Weights', active: true, variants: [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }], created_at: '2026-09-01' }], writes: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const table = url.pathname.split('/').pop();
    const prefer = new Headers(init?.headers).get('prefer') ?? '';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const ok = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), { status, headers: { 'content-type': 'application/json' } });
    if (table === 'vinax_experiments') return ok(db.experiments);
    if (table === 'vinax_feedback') { db.writes.push('audit'); return new Response(null, { status: 201 }); }
    if (table !== 'vinax_config') return ok([]);
    if (method === 'GET') {
      const keys = [...(url.searchParams.get('key') ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      return ok(keys.filter((k) => db.config.has(k)).map((k) => ({ key: k, ...db.config.get(k)! })));
    }
    if (method === 'POST' && prefer.includes('ignore-duplicates')) {
      db.writes.push(`insert ${body.key}`);
      if (db.config.has(body.key)) return ok([]);
      db.config.set(body.key, { value: body.value, updated_at: body.updated_at });
      return ok([body], 201);
    }
    if (method === 'POST') {
      db.writes.push(`upsert ${body.key}`);
      db.config.set(body.key, { value: body.value, updated_at: body.updated_at });
      return new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      const key = (url.searchParams.get('key') ?? '').replace(/^eq\./, '');
      const guard = url.searchParams.get('value->>version');
      db.writes.push(`patch ${key} ${guard}`);
      const cur = db.config.get(key);
      const curVersion = String((cur?.value as { version?: number } | undefined)?.version);
      if (!cur || guard !== `eq.${curVersion}`) return ok([]);
      db.config.set(key, { value: body.value, updated_at: body.updated_at });
      return ok([{ key, ...body }]);
    }
    return ok([]);
  });
}

const post = (body: unknown, token = 'test-secret'): Promise<Response> => {
  ipSeq += 1;
  return onRequestPost({
    request: new Request('https://admin.test/api/admin/recconfig', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token, 'cf-connecting-ip': `10.23.0.${ipSeq % 250}` }, body: JSON.stringify(body) }),
    env: ENV,
  });
};
const get = (token = 'test-secret'): Promise<Response> => {
  ipSeq += 1;
  return onRequestGet({ request: new Request('https://admin.test/api/admin/recconfig', { headers: { 'x-admin-token': token, 'cf-connecting-ip': `10.23.1.${ipSeq % 250}` } }), env: ENV });
};

describe('/api/admin/recconfig', () => {
  beforeEach(() => installDb());
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a wrong token on GET and POST before any database work', async () => {
    let touched = 0;
    vi.stubGlobal('fetch', () => { touched += 1; return Promise.resolve(new Response('[]')); });
    expect((await get('nope')).status).toBe(401);
    expect((await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' } }, 'nope')).status).toBe(401);
    expect(touched).toBe(0);
  });

  it('GET describes an empty store: version 0, the weight table, the evaluation command', async () => {
    const body = (await (await get()).json()) as { version: number; current: unknown; live: boolean; weights: Array<{ key: string; min: number; max: number }>; evalCommand: string; experiments: unknown[] };
    expect(body).toMatchObject({ version: 0, current: null, live: false, evalCommand: 'node frontend/scripts/eval-recs.mjs' });
    expect(body.weights.find((w) => w.key === 'mood')).toMatchObject({ min: 0.08, max: 0.32 });
    expect(body.experiments).toHaveLength(1);
  });

  it('requires expectedVersion', async () => {
    const res = await post({ overrides: { mood: 0.2 }, rollout: { mode: 'all' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('expected_version_required');
  });

  it('publishes v1 with an insert-if-absent, then v2 with an update guarded by the stored version', async () => {
    const first = await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' }, note: 'try more mood', by: 'ops' });
    expect(first.status).toBe(200);
    const one = (await first.json()) as { record: RecConfigRecord; historySaved: boolean };
    expect(one.record).toMatchObject({ version: 1, overrides: { mood: 0.2 }, rollout: { mode: 'all' }, note: 'try more mood', evaluation: null, updatedBy: 'ops' });
    expect(one.historySaved).toBe(true);
    expect(db.writes).toContain('insert rec-config');

    const second = await post({ expectedVersion: 1, overrides: { mood: 0.24 }, rollout: { mode: 'off' } });
    expect(second.status).toBe(200);
    expect(db.writes).toContain('patch rec-config eq.1');
    expect((db.config.get('rec-config')!.value as RecConfigRecord).version).toBe(2);
    expect(parseHistory(db.config.get('rec-config-history')!.value).map((r) => r.version)).toEqual([2, 1]);
    expect(db.writes.filter((w) => w === 'audit')).toHaveLength(2);
  });

  it('a stale editor gets 409 and the current record — nothing is written', async () => {
    await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' } });
    await post({ expectedVersion: 1, overrides: { mood: 0.22 }, rollout: { mode: 'all' } });
    db.writes.length = 0;
    const stale = await post({ expectedVersion: 1, overrides: { mood: 0.3 }, rollout: { mode: 'all' } });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; version: number; current: RecConfigRecord };
    expect(body).toMatchObject({ error: 'version_conflict', version: 2 });
    expect(body.current.overrides).toEqual({ mood: 0.22 });
    expect(db.writes).toEqual([]);
  });

  it('loses the race cleanly: when the guarded update matches nothing, the answer is 409', async () => {
    await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' } });
    // Another operator publishes between our read and our write.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        const cur = db.config.get('rec-config')!;
        db.config.set('rec-config', { ...cur, value: { ...(cur.value as object), version: 2 } });
      }
      return realFetch(input, init);
    });
    const res = await post({ expectedVersion: 1, overrides: { mood: 0.3 }, rollout: { mode: 'all' } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { version: number }).version).toBe(2);
  });

  it('rejects unknown keys with the problems listed and writes nothing', async () => {
    const res = await post({ expectedVersion: 0, overrides: { mood: 0.2, loudness: 1 }, rollout: { mode: 'all' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; problems: Array<{ field: string }> };
    expect(body.error).toBe('invalid');
    expect(body.problems[0].field).toBe('overrides.loudness');
    expect(db.writes).toEqual([]);
  });

  it('reports clamps and stages to an experiment variant', async () => {
    const res = await post({ expectedVersion: 0, overrides: { diversity: 3 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant: 'treatment' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: RecConfigRecord; clamped: unknown[] };
    expect(body.clamped).toEqual([{ key: 'diversity', requested: 3, applied: 0.4 }]);
    expect(body.record.rollout).toEqual({ mode: 'experiment', experimentKey: 'rec-weights', variant: 'treatment' });
    const view = (await (await get()).json()) as { live: boolean };
    expect(view.live).toBe(true);
  });

  it('rollback publishes an old version as a NEW version; history keeps the last 20', async () => {
    await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' }, evaluation: { summary: 'replay +2% completion', url: 'https://example.test/e/1' } });
    for (let v = 1; v <= 22; v += 1) await post({ expectedVersion: v, overrides: { mood: 0.2 + v / 1000 }, rollout: { mode: 'all' } });
    const hist = parseHistory(db.config.get('rec-config-history')!.value);
    expect(hist).toHaveLength(HISTORY_LIMIT);
    expect(hist[0].version).toBe(23);

    const target = hist[HISTORY_LIMIT - 1].version; // the oldest one still kept
    const rb = await post({ action: 'rollback', toVersion: target, expectedVersion: 23 });
    expect(rb.status).toBe(200);
    const rec = ((await rb.json()) as { record: RecConfigRecord }).record;
    expect(rec.version).toBe(24);
    expect(rec.overrides).toEqual(hist[HISTORY_LIMIT - 1].overrides);
    expect(rec.note).toBe(`Rollback to v${target}`);
    expect((await post({ action: 'rollback', toVersion: 1, expectedVersion: 24 })).status).toBe(404); // fell out of history
  });

  it('a rollback keeps the old evaluation with its overrides; a new version without one is unvalidated', async () => {
    await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' }, evaluation: { summary: 'replay', url: '' } });
    await post({ expectedVersion: 1, overrides: { mood: 0.3 }, rollout: { mode: 'all' } });
    expect((db.config.get('rec-config')!.value as RecConfigRecord).evaluation).toBeNull();
    const rb = (await (await post({ action: 'rollback', toVersion: 1, expectedVersion: 2 })).json()) as { record: RecConfigRecord };
    expect(rb.record.evaluation?.summary).toBe('replay');
  });

  it('a failed read is a 502, never an empty config', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 500 })));
    const res = await get();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('db_unavailable');
    expect((await post({ expectedVersion: 0, overrides: { mood: 0.2 }, rollout: { mode: 'all' } })).status).toBe(502);
  });
});
