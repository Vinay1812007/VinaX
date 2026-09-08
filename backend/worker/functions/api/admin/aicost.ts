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
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { readConfig } from '../../_lib/clientConfig';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export interface AiEventRow {
  created_at: string;
  feature: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export interface Price { in: number; out: number }
export type PriceTable = Record<string, Price>;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Sanitise the `ai-prices` config value: only `{prefix: {in, out}}` entries with non-negative numbers survive. */
export function parsePrices(raw: unknown): PriceTable {
  const out: PriceTable = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().slice(0, 120);
    if (!key || !v || typeof v !== 'object') continue;
    const p = v as { in?: unknown; out?: unknown };
    const pin = num(p.in);
    const pout = num(p.out);
    if (pin === null || pout === null) continue;
    out[key] = { in: pin, out: pout };
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

/** vinax_ai_events stores `slug @lane` — the slug alone is what gets priced. */
export function modelSlug(model: string | null): string {
  const m = (model ?? '').trim();
  if (!m) return '(none)';
  const at = m.indexOf(' @');
  return at > 0 ? m.slice(0, at) : m;
}

/** Longest-prefix price lookup (exact slug beats any prefix). */
export function matchPrice(model: string, prices: PriceTable): Price | null {
  let best: string | null = null;
  for (const key of Object.keys(prices)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? null : prices[best];
}

/** USD for one call: tokens / 1e6 × price per million, rounded to micro-dollars. */
export function costUsd(prompt: number, completion: number, price: Price | null): number {
  if (!price) return 0;
  const usd = (prompt / 1e6) * price.in + (completion / 1e6) * price.out;
  return Math.round(usd * 1e6) / 1e6;
}

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
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [rows, cfg] = await Promise.all([
    sbSelect<AiEventRow>(
      env,
      'vinax_ai_events',
      `created_at=gte.${encodeURIComponent(since)}&select=created_at,feature,model,prompt_tokens,completion_tokens&order=created_at.desc&limit=20000`,
    ).catch(() => [] as AiEventRow[]),
    readConfig(env, ['ai-prices']).catch(() => ({}) as Record<string, unknown>),
  ]);
  const prices = parsePrices(cfg['ai-prices']);
  return json({ configured: true, days, sampled: rows.length, ...aiCost(rows, prices), prices });
};
