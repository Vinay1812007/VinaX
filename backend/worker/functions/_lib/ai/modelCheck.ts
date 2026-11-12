/**
 * VinaX AI — the daily check of the paused models (models.ts PAUSED_MODELS).
 *
 * Once a day (the `ai-model-check` job, jobs.ts) each paused model whose
 * provider has a key gets one tiny request ("Reply with OK", the console's
 * probe). It passes when its first word arrives within 12 s, the wait Auto
 * gives a model before moving on. The results go in the `ai-model-check`
 * setting, `{ "<model id>": { ok, at, ms, kind? } }`, and config.ts offers a
 * paused model in the model menu while its latest check passed (and is less
 * than two days old, so a check that stopped running never keeps one in).
 * A model that fails a later check leaves the menu again. Paused models never
 * join an Auto ladder this way: they are picked by hand only.
 *
 * Providers are checked side by side, one model at a time each, so a
 * provider never sees a burst. Twelve requests a day at most.
 */
import { writeSetting } from '../settings';
import { MODEL_CHECK_KEY } from './config';
import type { DbEnv } from '../db';
import { providerConfigured } from './adapters';
import { MODELS, PAUSED_MODELS, modelById } from './models';
import { probeModel } from '../../api/admin/ai';
import type { AiEnv, ModelSpec } from './types';

/** The first word must come this soon (Auto's first-event wait). */
export const CHECK_FIRST_TOKEN_MS = 12_000;

export interface ModelCheck { ok: boolean; at: string; ms: number | null; kind?: string }

type Probe = (env: AiEnv, spec: ModelSpec) => Promise<{ ok: boolean; ms: number; firstTokenMs: number | null; kind?: string }>;

export async function runModelCheck(env: DbEnv & AiEnv, now = Date.now(), probe: Probe = probeModel): Promise<Record<string, unknown>> {
  const specs = [...PAUSED_MODELS].map((id) => modelById(MODELS, id)).filter((s): s is ModelSpec => !!s && providerConfigured(env, s.provider));
  if (!specs.length) return { checked: 0, skipped: 'no paused model has a key' };
  const byProvider = new Map<string, ModelSpec[]>();
  for (const s of specs) byProvider.set(s.provider, [...(byProvider.get(s.provider) ?? []), s]);
  const at = new Date(now).toISOString();
  const results: Record<string, ModelCheck> = {};
  await Promise.all([...byProvider.values()].map(async (list) => {
    for (const spec of list) {
      try {
        const r = await probe(env, spec);
        const ok = r.ok && r.firstTokenMs != null && r.firstTokenMs <= CHECK_FIRST_TOKEN_MS;
        results[spec.id] = { ok, at, ms: r.firstTokenMs ?? r.ms, ...(ok ? {} : { kind: r.kind ?? 'slow' }) };
      } catch {
        results[spec.id] = { ok: false, at, ms: null, kind: 'network' };
      }
    }
  }));
  const w = await writeSetting(env, MODEL_CHECK_KEY, results, 'model-check');
  if (!w.ok) throw new Error(`ai-model-check: ${w.error}`);
  const answered = Object.entries(results).filter(([, c]) => c.ok).map(([id]) => id);
  return { checked: specs.length, answered, stillPaused: specs.length - answered.length };
}
