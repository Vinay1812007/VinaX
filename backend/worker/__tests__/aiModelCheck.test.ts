/**
 * VinaX AI — the daily check of the paused models: who gets asked, what
 * counts as a pass, where it is written, and how a passed check puts a
 * paused model back in the model menu (never in a ladder) for two days.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runModelCheck, CHECK_FIRST_TOKEN_MS } from '../functions/_lib/ai/modelCheck';
import { MODEL_CHECK_KEY, pickerRegistryFor, registryFor, revivedFrom, REVIVED_FOR_MS, sanitizeAiSettings } from '../functions/_lib/ai/config';
import { LADDERS, MODELS, PAUSED_MODELS } from '../functions/_lib/ai/models';
import { JOBS } from '../functions/_lib/jobs';
import { onRequestGet as modelsGet } from '../functions/api/ai/models';
import { onRequestGet as adminGet } from '../functions/api/admin/ai';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetDiscovery } from '../functions/_lib/ai/discovery';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import type { AiEnv, ModelSpec } from '../functions/_lib/ai/types';

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const DEEPSEEK = 'nvidia:deepseek-ai/deepseek-v4.1-flash';
const GLM = 'nvidia:z-ai/glm-5.3-flash';
const GEMINI38 = 'gemini:gemini-3.8-flash';

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); _resetDiscovery(); });

describe('the daily check', () => {
  it('asks each paused model with a key once, passes only a quick answer, and writes the results', async () => {
    const fake = fakeDb({ settings: [] });
    const asked: string[] = [];
    const probe = vi.fn(async (_env: AiEnv, spec: ModelSpec) => {
      asked.push(spec.id);
      if (spec.id === DEEPSEEK) return { ok: true, ms: 900, firstTokenMs: 800 };
      if (spec.id === GLM) return { ok: true, ms: 15_500, firstTokenMs: CHECK_FIRST_TOKEN_MS + 3_000 };
      return { ok: false, ms: 25_000, firstTokenMs: null, kind: 'timeout' };
    });
    const env = { ...DB_ENV, NVIDIA_API_KEY: 'nv', GEMINI_API_KEY: 'g' };
    const r = await runModelCheck(env, NOW, probe);
    const expected = [...PAUSED_MODELS].filter((id) => id.startsWith('nvidia:') || id.startsWith('gemini:'));
    expect(asked.sort()).toEqual(expected.sort());
    expect(r).toMatchObject({ checked: expected.length, answered: [DEEPSEEK], stillPaused: expected.length - 1 });
    const row = fake.rows('settings').find((x) => x.key === MODEL_CHECK_KEY) as { value: Record<string, { ok: boolean; kind?: string; at: string }> };
    expect(row.value[DEEPSEEK]).toEqual({ ok: true, at: new Date(NOW).toISOString(), ms: 800 });
    expect(row.value[GLM]).toMatchObject({ ok: false, kind: 'slow' });
    expect(row.value[GEMINI38]).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('asks nothing when no paused model has a key', async () => {
    fakeDb({ settings: [] });
    const probe = vi.fn();
    expect(await runModelCheck({ ...DB_ENV }, NOW, probe as never)).toMatchObject({ checked: 0 });
    expect(probe).not.toHaveBeenCalled();
  });

  it('is a daily job the owner can slow to twice a day', () => {
    expect(JOBS.find((j) => j.id === 'ai-model-check')).toMatchObject({ every: 1440, choices: [720, 1440] });
  });
});

describe('a passed check puts a paused model back in the menu', () => {
  const at = new Date(NOW - 60_000).toISOString();

  it('only paused ids, only a pass, only within two days', () => {
    const check = {
      [DEEPSEEK]: { ok: true, at },
      [GLM]: { ok: false, at },
      [GEMINI38]: { ok: true, at: new Date(NOW - REVIVED_FOR_MS - 1).toISOString() },
      'groq:made-up': { ok: true, at },
    };
    expect(revivedFrom(check, NOW)).toEqual([DEEPSEEK]);
    for (const junk of [null, 'x', [1], { [DEEPSEEK]: 'yes' }, { [DEEPSEEK]: { ok: true, at: 'soon' } }]) expect(revivedFrom(junk, NOW), JSON.stringify(junk)).toEqual([]);
  });

  it('in the picker and the registry, never in a ladder; without a check, still paused', async () => {
    const s = sanitizeAiSettings({}, { [DEEPSEEK]: { ok: true, at } }, NOW);
    expect(registryFor(s).map((m) => m.id)).toContain(DEEPSEEK);
    expect((await pickerRegistryFor({} as AiEnv, s)).map((m) => m.id)).toContain(DEEPSEEK);
    for (const ids of Object.values(LADDERS)) expect(ids).not.toContain(DEEPSEEK);
    const paused = sanitizeAiSettings({}, null, NOW);
    expect(registryFor(paused).map((m) => m.id)).not.toContain(DEEPSEEK);
    // The owner's switch still wins.
    const off = sanitizeAiSettings({ models: { [DEEPSEEK]: { enabled: false } } }, { [DEEPSEEK]: { ok: true, at } }, NOW);
    expect(registryFor(off).map((m) => m.id)).not.toContain(DEEPSEEK);
    expect(MODELS.some((m) => m.id === DEEPSEEK)).toBe(true);
  });

  it('GET /api/ai/models lists a model whose check passed today', async () => {
    const today = new Date().toISOString();
    fakeDb({ settings: [{ key: 'vinax-ai', value: { enabled: true }, updated_at: 'x', updated_by: 'owner' }, { key: MODEL_CHECK_KEY, value: { [DEEPSEEK]: { ok: true, at: today } }, updated_at: 'x', updated_by: 'model-check' }] });
    const res = await modelsGet({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': '198.51.100.77' } }), env: { ...DB_ENV, NVIDIA_API_KEY: 'nv' } as never });
    const body = await res.json() as { models: Array<{ id: string; available: boolean }> };
    expect(body.models.find((m) => m.id === DEEPSEEK)).toMatchObject({ available: true });
    expect(body.models.some((m) => m.id === GLM)).toBe(false);
  });

  it('the console marks a model whose check passed as back, the others as Paused', async () => {
    const today = new Date().toISOString();
    fakeDb({ settings: [{ key: MODEL_CHECK_KEY, value: { [DEEPSEEK]: { ok: true, at: today } }, updated_at: 'x', updated_by: 'model-check' }] });
    const env = { ...DB_ENV, ADMIN_LOGIN_PASSWORD: 'owner-pass', NVIDIA_API_KEY: 'nv' };
    const res = await adminGet({ request: new Request('https://www.vinaxmusic.online/api/admin/ai', { headers: { 'x-admin-token': 'owner-pass', 'cf-connecting-ip': '203.0.113.77' } }), env: env as never });
    const body = await res.json() as { models: Array<{ id: string; paused?: boolean; revived?: boolean; ownerEnabled: boolean }> };
    expect(body.models.find((m) => m.id === DEEPSEEK)).toMatchObject({ revived: true, ownerEnabled: true });
    expect(body.models.find((m) => m.id === DEEPSEEK)?.paused).toBeUndefined();
    expect(body.models.find((m) => m.id === GLM)).toMatchObject({ paused: true, ownerEnabled: false });
  });
});
