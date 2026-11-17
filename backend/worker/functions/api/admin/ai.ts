/**
 * Owner console — VinaX AI providers (Health → VinaX AI).
 *
 *   GET  /api/admin/ai
 *     → { settings: { enabled, testers, search, overrides },
 *         providers: [{ id, name, configured, restingUntil, lastError: { kind, status, at } | null }],
 *         models: [{ id, name, provider, group, ownerEnabled, order, configured, restingUntil, restKind }],
 *         search: { api: { configured, provider, dailyLimit, usedToday }, grounding: { configured, dailyLimit, usedToday } },
 *         voice: { dictation, readAloud, live, resting: [{ model, until }] },
 *         utility: [{ id, name, provider, kind: guard|embedding|parse|aqa, configured }],
 *         feedback: { days: 30, models: { "<model id>": { up, down } } } | null,
 *         checkedAt }
 *     `models` is the curated registry (models.ts); a model joins it only by
 *     its id in APPROVED_MODELS. `feedback`: the listeners' thumbs up and
 *     down on each model's replies in the last 30 days (ai_feedback, schema
 *     24; POST /api/ai/feedback), null when the database cannot say.
 *   POST /api/admin/ai { model: "<registry id>" }
 *     → { model, ok, ms, firstTokenMs, kind?, status? }
 *     One tiny request ("Reply with OK") to that model. A failure rests it
 *     like any chat failure; an answer ends its rest. The console probes
 *     one model per request, on a button press only: probes spend the
 *     providers' free allowance, so nothing probes on a schedule.
 *
 * Rests and last errors live in each Worker instance's memory, so this is
 * what the instance that answers has seen. Never returns a key, an
 * upstream host or a provider's own words.
 */
import { adminJson, badRequest, isAdminAsync, requireRole, unauthorized, type AdminAuthEnv } from '../../_lib/admin';
import { readJsonCapped } from '../../_lib/body';
import { db, dbConfigured, q } from '../../_lib/db';
import { PROVIDER_NAMES, PROVIDERS, providerConfigured } from '../../_lib/ai/adapters';
import { aiSettings, pickerRegistryFor, sanitizeAiSettings } from '../../_lib/ai/config';
import { clearRest, coolingUntil, cooldownSnapshot } from '../../_lib/ai/cooldown';
import { isApproved, MODELS, PAUSED_MODELS, UTILITY_MODELS, ladderModels, modelById } from '../../_lib/ai/models';
import { runChat } from '../../_lib/ai/router';
import { dailyLimit, GROUNDING_DAILY_LIMIT, providerOf, searchConfigured } from '../../_lib/ai/search';
import { voiceAvailability, voiceRestSnapshot } from '../../_lib/ai/voice';
import type { AiEnv, ModelSpec, ProviderId } from '../../_lib/ai/types';

type Env = AiEnv & AdminAuthEnv;

/** Today's uses of each daily allowance (null when the database cannot say). */
async function usedToday(env: Env): Promise<Record<string, number> | null> {
  if (!dbConfigured(env)) return null;
  const day = new Date().toISOString().slice(0, 10);
  const r = await db.select<{ kind: string; count: number }>(env, 'ai_daily_usage', q().select('kind,count').eq('day', day));
  if (!r.ok) return null;
  return Object.fromEntries(r.rows.map((row) => [row.kind, Number(row.count) || 0]));
}

/** How many days of thumbs the models table scores. */
export const FEEDBACK_DAYS = 30;

/** Each model's thumbs up and down in the last FEEDBACK_DAYS days (ai_feedback_stats, schema 24); null when the database cannot say. */
async function feedbackScores(env: Env): Promise<{ days: number; models: Record<string, { up: number; down: number }> } | null> {
  if (!dbConfigured(env)) return null;
  const r = await db.rpc<Array<{ model: unknown; up: unknown; down: unknown }> | null>(env, 'ai_feedback_stats', { p_days: FEEDBACK_DAYS });
  if (!r.ok || !Array.isArray(r.value)) return null;
  const models: Record<string, { up: number; down: number }> = {};
  for (const row of r.value) {
    if (typeof row?.model !== 'string' || !row.model) continue;
    models[row.model] = { up: Math.max(0, Number(row.up) || 0), down: Math.max(0, Number(row.down) || 0) };
  }
  return { days: FEEDBACK_DAYS, models };
}

export const onRequestGet = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const now = Date.now();
  const settings = dbConfigured(env) ? await aiSettings(env) : sanitizeAiSettings(null);
  const registry = await pickerRegistryFor(env, settings, { waitUntil: ctx.waitUntil });
  const snap = cooldownSnapshot(now);
  const restOf = (key: string) => snap.rests.find((r) => r.key === key) ?? null;
  const providers = PROVIDERS.map((id: ProviderId) => ({
    id,
    name: PROVIDER_NAMES[id],
    configured: providerConfigured(env, id),
    restingUntil: restOf(`${id}|*`)?.until ?? null,
    lastError: snap.lastErrors[id] ?? null,
  }));
  const overrides = settings.models as Record<string, { enabled?: unknown; order?: unknown }>;
  const models = MODELS.map((spec) => {
    const until = coolingUntil(spec, now);
    const own = restOf(`${spec.provider}|${spec.upstream}`) ?? restOf(`${spec.provider}|*`);
    const o = overrides[spec.id];
    return {
      id: spec.id,
      name: spec.name,
      provider: PROVIDER_NAMES[spec.provider],
      group: spec.group,
      ownerEnabled: registry.some((r) => r.id === spec.id),
      order: o && typeof o.order === 'number' ? o.order : null,
      configured: providerConfigured(env, spec.provider),
      restingUntil: until > now ? new Date(until).toISOString() : null,
      restKind: until > now ? own?.kind ?? null : null,
      // Approved but paused after failing the live check (models.ts): offered nowhere, but the owner can test it;
      // `revived`: its latest daily check passed, so it is in the model menu again (modelCheck.ts).
      ...(PAUSED_MODELS.has(spec.id) ? (settings.revived.includes(spec.id) ? { revived: true } : { paused: true }) : {}),
    };
  });
  const [used, feedback] = await Promise.all([usedToday(env), feedbackScores(env)]);
  return adminJson({
    settings: { enabled: settings.enabled, testers: settings.testers, search: settings.search, overrides: Object.keys(settings.models).length },
    providers,
    models,
    search: {
      api: { configured: searchConfigured(env, settings.limits.searchesPerDay), provider: providerOf(env), dailyLimit: dailyLimit(env, settings.limits.searchesPerDay), usedToday: used ? used.search ?? 0 : null },
      grounding: { configured: ladderModels(registry, 'grounded').some((s) => providerConfigured(env, s.provider)), dailyLimit: GROUNDING_DAILY_LIMIT, usedToday: used ? used.grounding ?? 0 : null },
    },
    voice: { ...voiceAvailability(env), resting: voiceRestSnapshot(now) },
    utility: UTILITY_MODELS.map((x) => ({ id: x.id, name: x.name, provider: PROVIDER_NAMES[x.provider], kind: x.kind, configured: providerConfigured(env, x.provider) })),
    feedback,
    checkedAt: new Date(now).toISOString(),
  });
};

/** One tiny request to one model: time to its first event and to its first word. */
export async function probeModel(env: AiEnv, spec: ModelSpec): Promise<{ model: string; ok: boolean; ms: number; firstTokenMs: number | null; kind?: string; status?: number | null }> {
  const id = spec.id;
  const t0 = Date.now();
  const ac = new AbortController();
  let firstTokenMs: number | null = null;
  try {
    for await (const ev of runChat(env, {
      candidates: [spec],
      picked: true,
      build: (s) => ({ model: s, system: 'You are a health check. Reply with the single word OK.', messages: [{ role: 'user', text: 'Reply with OK.' }], maxOutputTokens: 256, reasoning: 'off', webSearch: false }),
      signal: ac.signal,
      firstEventMs: Math.max(15_000, spec.firstEventMs ?? 0),
      budgetMs: Math.max(25_000, (spec.firstEventMs ?? 0) + 10_000),
    })) {
      if (ev.type === 'failed') return { model: id, ok: false, ms: Date.now() - t0, firstTokenMs, kind: ev.error.kind, status: ev.error.status };
      if ((ev.type === 'text' || ev.type === 'thinking') && firstTokenMs == null) firstTokenMs = Date.now() - t0;
      if (ev.type === 'text') {
        // One word is enough: stop now and spend no more of the allowance.
        ac.abort();
        break;
      }
      if (ev.type === 'end') break;
    }
  } catch {
    return { model: id, ok: false, ms: Date.now() - t0, firstTokenMs, kind: 'network', status: null };
  }
  if (firstTokenMs == null) return { model: id, ok: false, ms: Date.now() - t0, firstTokenMs, kind: 'empty', status: null };
  clearRest(spec);
  return { model: id, ok: true, ms: Date.now() - t0, firstTokenMs };
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  // Probing spends provider quota: editors and owners only.
  const auth = await requireRole(request, env, 'editor');
  if (!auth.ok) return auth.response;
  const read = await readJsonCapped<{ model?: unknown } | null>(request, 4 * 1024);
  if (!read.ok) return badRequest();
  const id = read.value && typeof read.value === 'object' ? read.value.model : null;
  // A curated model (switched off or not: the owner may test it); approved models only (models.ts
  // APPROVED_MODELS), like everywhere else, and the paused ones, so the owner can see when one answers
  // again before moving it back.
  const spec = modelById(MODELS, id);
  if (!spec || !(isApproved(spec.id) || PAUSED_MODELS.has(spec.id))) return badRequest('unknown_model');
  if (!providerConfigured(env, spec.provider)) return adminJson({ model: spec.id, ok: false, ms: 0, firstTokenMs: null, kind: 'not_configured', status: null });
  const r = await probeModel(env, spec);
  console.log(JSON.stringify({ route: 'admin-ai-probe', model: spec.id, provider: spec.provider, ok: r.ok, ms: r.ms, kind: r.kind ?? null }));
  return adminJson(r);
};
