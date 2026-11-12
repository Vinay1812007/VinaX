/**
 * VinaX AI — Cowork (Claude on Managed Agents; _lib/ai/cowork.ts).
 *
 *   GET  /api/ai/cowork   Authorization: Bearer <session>
 *     → 200 { allowed, configured, ready, models: [{ id, name, description }], efforts, defaultEffort,
 *             budgetCents, minBudgetCents, maxBudgetCents, maxUploadBytes,
 *             tasks: [{ id, title, status, createdAt, updatedAt, costCents, budgetCents, model }] }
 *     allowed false (anyone not in claudeAccess.ts, or signed out): no tasks, nothing else read.
 *
 *   POST /api/ai/cowork   { title, model?, effort?, budgetCents?, files?: [{ id, name }] }
 *     → 200 { task }   a new, idle task. The page then opens its stream
 *       (GET /api/ai/cowork/tasks/<id>/stream) and only then sends the first
 *       message (POST …/events), so no event is missed.
 *     → 400 bad_request · 401 signed_out · 403 model_locked · 502 upstream { status, message? } · 503 cowork_not_configured | unavailable
 *
 * The rest is /api/ai/cowork/<path> ([path].ts).
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { providerConfigured } from '../../_lib/ai/adapters';
import { claudeAllowed } from '../../_lib/ai/claudeAccess';
import {
  clampBudget, COWORK_APP, COWORK_EFFORTS, COWORK_MODELS, coworkSetting, DEFAULT_EFFORT, ensureSetup, FILE_ID, isCoworkSession, maError, maJson,
  MAX_BUDGET_CENTS, MAX_UPLOAD_BYTES, MIN_BUDGET_CENTS, safeFileName, sessionAgent, sessionSummary, type CoworkEffort,
} from '../../_lib/ai/cowork';
import type { AiEnv } from '../../_lib/ai/types';

interface Ctx {
  request: Request;
  env: AiEnv;
  params?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });

/** Signed in, one of Claude's accounts, a key and a database: the account id, or the refusal. */
export async function coworkGate(ctx: Ctx, route: string, capacity = 60): Promise<{ sub: string } | Response> {
  const limited = await rateLimitAsync(ctx.request, route, { capacity, refillPerMinute: capacity }, ctx.env);
  if (limited) return limited;
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  if (!(await claudeAllowed(ctx.env, sub))) return json({ error: 'model_locked' }, 403);
  if (!providerConfigured(ctx.env, 'anthropic')) return json({ error: 'cowork_not_configured' }, 503);
  return { sub };
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-cowork', { capacity: 60, refillPerMinute: 60 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  const allowed = !!sub && dbConfigured(env) && (await claudeAllowed(env, sub));
  const base = { allowed, models: COWORK_MODELS, efforts: COWORK_EFFORTS, defaultEffort: DEFAULT_EFFORT, minBudgetCents: MIN_BUDGET_CENTS, maxBudgetCents: MAX_BUDGET_CENTS, maxUploadBytes: MAX_UPLOAD_BYTES };
  if (!allowed) return json({ ...base, configured: false, ready: false, budgetCents: null, tasks: [] });
  const configured = providerConfigured(env, 'anthropic');
  const s = await coworkSetting(env);
  if (!configured) return json({ ...base, configured, ready: false, budgetCents: s.budgetCents, tasks: [] });
  const list = await maJson<{ data?: unknown[] }>(env, '/sessions?limit=100');
  const tasks = list.ok && Array.isArray(list.body.data) ? list.body.data.filter(isCoworkSession).map(sessionSummary).filter(Boolean) : [];
  return json({ ...base, configured, ready: !!(s.agentId && s.environmentId), budgetCents: s.budgetCents, tasks, ...(list.ok ? {} : { listError: maError(list) }) });
};

interface CreateBody {
  title?: unknown;
  model?: unknown;
  effort?: unknown;
  budgetCents?: unknown;
  files?: unknown;
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const gate = await coworkGate(ctx, 'ai-cowork-create', 20);
  if (gate instanceof Response) return gate;
  const { env } = ctx;
  const read = await readJsonCapped<CreateBody | null>(ctx.request, 16 * 1024);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const b = read.value && typeof read.value === 'object' ? read.value : {};
  const model = typeof b.model === 'string' && COWORK_MODELS.some((m) => m.id === b.model) ? b.model : COWORK_MODELS[0].id;
  const effort: CoworkEffort = typeof b.effort === 'string' && (COWORK_EFFORTS as readonly string[]).includes(b.effort) ? (b.effort as CoworkEffort) : DEFAULT_EFFORT;
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const files = Array.isArray(b.files) ? b.files.slice(0, 20) : [];
  const resources: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  for (const f of files) {
    const id = (f as { id?: unknown })?.id;
    if (typeof id !== 'string' || !FILE_ID.test(id)) return json({ error: 'bad_request' }, 400);
    let name = safeFileName((f as { name?: unknown }).name, id);
    // Two files with one name would mount over each other.
    for (let i = 2; used.has(name); i++) name = `${i}-${safeFileName((f as { name?: unknown }).name, id)}`;
    used.add(name);
    resources.push({ type: 'file', file_id: id, mount_path: `/${name}` });
  }

  const setup = await ensureSetup(env);
  if (!setup.ok) {
    console.log(JSON.stringify({ route: 'ai-cowork', setup: setup.step, status: setup.failure?.status ?? null }));
    return json(setup.failure ? { ...maError(setup.failure), step: setup.step } : { error: 'unavailable' }, setup.failure ? 502 : 503);
  }
  const budgetCents = clampBudget(b.budgetCents, setup.setting.budgetCents);
  const r = await maJson(env, '/sessions', {
    method: 'POST',
    body: {
      agent: sessionAgent(setup.setting, model, effort),
      environment_id: setup.setting.environmentId,
      title: title || 'New task',
      ...(resources.length ? { resources } : {}),
      budget: { type: 'limit', max_list_cost: { amount: String(budgetCents), currency: 'USD' } },
      metadata: { app: COWORK_APP, account: gate.sub, effort },
    },
  });
  if (!r.ok) return json(maError(r), 502);
  const task = sessionSummary(r.body);
  if (!task) return json({ error: 'upstream', status: r.status }, 502);
  console.log(JSON.stringify({ route: 'ai-cowork', created: task.id, model, effort, budgetCents, files: resources.length }));
  return json({ task: { ...task, model, budgetCents } });
};
