/**
 * Admin: AI Cost (v5.16.0).
 *   GET /api/admin/aicost?days=7 →
 *     { configured, days, sampled, tokensTotal:{prompt,completion},
 *       byModel:[{model,calls,prompt,completion,cost}], byDay:[{day,prompt,completion,cost}],
 *       prices, unpriced }
 * Token counts come from vinax_ai_events (prompt_tokens / completion_tokens,
 * logged since v5.16.0 — older rows count as calls with zero tokens). Prices
 * are the operator's own table in config key `ai-prices`:
 *   { "<model slug or prefix>": { "in": <USD per 1M prompt tokens>, "out": <USD per 1M completion tokens> } }
 * A model matches the LONGEST prefix key; there are no built-in prices, so
 * `unpriced: true` is the panel's cue to fill the table in. Cost is USD.
 */
import { dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { costUsd, matchPrice, modelSlug, parsePrices, type Price, type PriceTable } from '../../_lib/ai';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

// 7.2.0 — the price helpers moved to _lib/ai.ts, where the daily spend cap
// uses the same table; re-exported so existing importers keep working.
export { costUsd, matchPrice, modelSlug, parsePrices, type Price, type PriceTable };

type Env = AdminEnv & SupabaseEnv;

export interface AiEventRow {
  created_at: string;
  feature: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export interface AiCostReport {
  tokensTotal: { prompt: number; completion: number };
  byModel: Array<{ model: string; calls: number; prompt: number; completion: number; cost: number; priced: boolean }>;
  byDay: Array<{ day: string; prompt: number; completion: number; cost: number }>;
  unpriced: boolean;
}

export function aiCost(rows: AiEventRow[], prices: PriceTable): AiCostReport {
  const models = new Map<string, { calls: number; prompt: number; completion: number; price: Price | null }>();
  const days = new Map<string, { prompt: number; completion: number; cost: number }>();
  const total = { prompt: 0, completion: 0 };
  for (const r of rows) {
    const slug = modelSlug(r.model);
    const p = num(r.prompt_tokens) ?? 0;
    const c = num(r.completion_tokens) ?? 0;
    const m = models.get(slug) ?? { calls: 0, prompt: 0, completion: 0, price: matchPrice(slug, prices) };
    m.calls += 1;
    m.prompt += p;
    m.completion += c;
    models.set(slug, m);
    total.prompt += p;
    total.completion += c;
    const day = (r.created_at ?? '').slice(0, 10) || 'unknown';
    const d = days.get(day) ?? { prompt: 0, completion: 0, cost: 0 };
    d.prompt += p;
    d.completion += c;
    d.cost += costUsd(p, c, m.price);
    days.set(day, d);
  }
  const byModel = [...models.entries()]
    .map(([model, m]) => ({ model, calls: m.calls, prompt: m.prompt, completion: m.completion, cost: costUsd(m.prompt, m.completion, m.price), priced: m.price !== null }))
    .sort((a, b) => b.cost - a.cost || b.prompt + b.completion - (a.prompt + a.completion) || b.calls - a.calls);
  const byDay = [...days.entries()]
    .map(([day, d]) => ({ day, prompt: d.prompt, completion: d.completion, cost: Math.round(d.cost * 1e6) / 1e6 }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const unpriced = Object.keys(prices).length === 0 || (byModel.length > 0 && !byModel.some((m) => m.priced));
  return { tokensTotal: total, byModel, byDay, unpriced };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [events, cfg] = await Promise.all([
    sbSelectResult<AiEventRow>(
      env,
      'vinax_ai_events',
      `created_at=gte.${encodeURIComponent(since)}&select=created_at,feature,model,prompt_tokens,completion_tokens&order=created_at.desc&limit=20000`,
    ),
    // Read directly (not through the swallowing config memo): a failed price
    // read must not render as "no prices entered, $0".
    sbSelectResult<{ value: unknown }>(env, 'vinax_config', 'key=eq.ai-prices&select=value&limit=1'),
  ]);
  // 7.2.0 — token totals and costs from a failed read would all read 0.
  if (!events.ok) return dbFailure(events);
  if (!cfg.ok) return dbFailure(cfg);
  const rows = events.rows;
  const prices = parsePrices(cfg.rows[0]?.value);
  return json({ configured: true, days, sampled: rows.length, ...aiCost(rows, prices), prices });
};
