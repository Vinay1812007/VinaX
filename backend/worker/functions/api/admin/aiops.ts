/**
 * Admin: AI Operations (7.2.0).
 *
 *   GET /api/admin/aiops?days=7 →
 *     { configured, days, sampled, truncated, totals, byFeature, byLane,
 *       tokenColumns, today, controls, budget, prices: { read, configured }, controlFeatures }
 *
 * Per feature and per provider lane (the `@lane` suffix of vinax_ai_events.model):
 * calls, failure rate (with a 95 % Wilson interval), latency p50/p95,
 * fallback hops, calls refused by the owner's controls, token totals and a
 * cost estimate from the operator's `ai-prices` table (the same helpers as
 * AI Tokens & Cost). A model with no price, or a call whose provider
 * reported no token counts, makes a cost UNKNOWN — it is never counted as 0:
 * `cost.usd` is the known part and `cost.complete` says whether that is all.
 *
 * `controls` is the published `ai-controls` value (emergency switch,
 * per-feature switches, daily caps) with who / when; `budget` sets the caps
 * against what today (UTC) has used so far.
 *
 * A failed events read answers 502 with the failure's kind, never zeros. A
 * failed config read leaves the numbers and marks controls and prices unknown.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { percentile } from '../../_lib/laneHealth';
import { dbErrorCode, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { costUsd, matchPrice, modelSlug, parsePrices, type PriceTable } from './aicost';
import { wilson, type Rate } from './recquality';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const ROW_CAP = 20_000;

/** The switchable AI features of the `ai-controls` contract, in display order. */
export const AI_CONTROL_FEATURES = [
  'dj', 'curate-metadata', 'curate-ranking', 'curate-home', 'curate-shelves', 'playlist', 'vinaxai', 'assistant', 'tts', 'lyrics', 'image', 'embed', 'search',
] as const;
export type AiControlFeature = (typeof AI_CONTROL_FEATURES)[number];

export interface AiOpsRow {
  created_at: string | null;
  feature: string | null;
  model: string | null;
  ok: boolean | null;
  status: number | null;
  error: string | null;
  latency_ms: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface OpsGroup {
  key: string;
  calls: number;
  failures: number;
  failureRate: Rate;
  latencyMs: { n: number; p50: number | null; p95: number | null };
  /** A sibling lane had to cover the call, or the attempt timed out. */
  hops: number;
  /** Calls refused by the owner's controls (503 ai_disabled / ai_over_budget), when routes log them. */
  blocked: { disabled: number; overBudget: number };
  tokens: { prompt: number; completion: number; reportedCalls: number };
  cost: CostEstimate;
}

export interface CostEstimate {
  /** USD for the calls that have both token counts and a price; null when none has. */
  usd: number | null;
  pricedCalls: number;
  /** Calls with token counts but no price for their model. */
  unpricedCalls: number;
  /** Calls whose provider reported no token counts. */
  unreportedCalls: number;
  /** True only when every call in the group is priced. */
  complete: boolean;
}

export interface AiControls {
  emergencyOff: boolean;
  features: Record<AiControlFeature, boolean>;
  dailyTokenCap: number | null;
  dailyCostCapUsd: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cap = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const tokens = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** The published `ai-controls` value, sanitised. A feature is on unless it is exactly `false`. */
export function parseAiControls(raw: unknown): AiControls | null {
  const o = obj(raw);
  if (!o) return null;
  const f = obj(o.features) ?? {};
  const features = Object.fromEntries(AI_CONTROL_FEATURES.map((k) => [k, f[k] !== false])) as Record<AiControlFeature, boolean>;
  const at = typeof o.updatedAt === 'string' && !Number.isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : null;
  const by = typeof o.updatedBy === 'string' ? o.updatedBy.trim().slice(0, 40) || null : null;
  return { emergencyOff: o.emergencyOff === true, features, dailyTokenCap: cap(o.dailyTokenCap), dailyCostCapUsd: cap(o.dailyCostCapUsd), updatedAt: at, updatedBy: by };
}

export function laneOf(model: string | null): string {
  const m = /\s@([A-Za-z0-9_-]+)\s*$/.exec(model ?? '');
  return m ? m[1] : '(none)';
}

export function isHop(error: string | null): boolean {
  const e = error ?? '';
  return e.startsWith('engine_fallback_') || e === 'engine_timeout';
}

interface Acc { calls: number; failures: number; lat: number[]; hops: number; disabled: number; over: number; prompt: number; completion: number; reported: number; usd: number; priced: number; unpriced: number; unreported: number }
const newAcc = (): Acc => ({ calls: 0, failures: 0, lat: [], hops: 0, disabled: 0, over: 0, prompt: 0, completion: 0, reported: 0, usd: 0, priced: 0, unpriced: 0, unreported: 0 });

function add(a: Acc, r: AiOpsRow, prices: PriceTable | null): void {
  a.calls += 1;
  if (r.ok !== true) a.failures += 1;
  if (typeof r.latency_ms === 'number' && Number.isFinite(r.latency_ms) && r.latency_ms >= 0) a.lat.push(r.latency_ms);
  if (isHop(r.error)) a.hops += 1;
  if (r.error === 'ai_disabled') a.disabled += 1;
  if (r.error === 'ai_over_budget') a.over += 1;
  const p = tokens(r.prompt_tokens);
  const c = tokens(r.completion_tokens);
  if (p === null || c === null) {
    a.unreported += 1;
    return;
  }
  a.reported += 1;
  a.prompt += p;
  a.completion += c;
  const price = prices ? matchPrice(modelSlug(r.model), prices) : null;
  if (!price) {
    a.unpriced += 1;
    return;
  }
  a.priced += 1;
  a.usd += costUsd(p, c, price);
}

export function costOf(a: Pick<Acc, 'usd' | 'priced' | 'unpriced' | 'unreported'>): CostEstimate {
  return {
    usd: a.priced ? Math.round(a.usd * 1e6) / 1e6 : null,
    pricedCalls: a.priced,
    unpricedCalls: a.unpriced,
    unreportedCalls: a.unreported,
    complete: a.unpriced === 0 && a.unreported === 0,
  };
}

function finish(key: string, a: Acc): OpsGroup {
  const sorted = [...a.lat].sort((x, y) => x - y);
  return {
    key,
    calls: a.calls,
    failures: a.failures,
    failureRate: wilson(a.failures, a.calls),
    latencyMs: { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
    hops: a.hops,
    blocked: { disabled: a.disabled, overBudget: a.over },
    tokens: { prompt: a.prompt, completion: a.completion, reportedCalls: a.reported },
    cost: costOf(a),
  };
}

export interface AiOpsReport {
  totals: OpsGroup;
  byFeature: OpsGroup[];
  byLane: OpsGroup[];
  today: { day: string; calls: number; tokens: number; cost: CostEstimate };
}

/** Pure aggregation. `prices` null = the price table could not be read (every cost unknown). */
export function aggregateAiOps(rows: AiOpsRow[], prices: PriceTable | null, now = new Date()): AiOpsReport {
  const totals = newAcc();
  const today = newAcc();
  const byFeature = new Map<string, Acc>();
  const byLane = new Map<string, Acc>();
  const day = now.toISOString().slice(0, 10);
  const into = (m: Map<string, Acc>, k: string): Acc => {
    let a = m.get(k);
    if (!a) { a = newAcc(); m.set(k, a); }
    return a;
  };
  for (const r of rows) {
    const feature = (r.feature ?? '').trim().slice(0, 40) || '(none)';
    add(totals, r, prices);
    add(into(byFeature, feature), r, prices);
    add(into(byLane, laneOf(r.model)), r, prices);
    if ((r.created_at ?? '').slice(0, 10) === day) add(today, r, prices);
  }
  const list = (m: Map<string, Acc>): OpsGroup[] => [...m.entries()].map(([k, a]) => finish(k, a)).sort((x, y) => y.calls - x.calls);
  return {
    totals: finish('all', totals),
    byFeature: list(byFeature),
    byLane: list(byLane).slice(0, 40),
    today: { day, calls: today.calls, tokens: today.prompt + today.completion, cost: costOf(today) },
  };
}

export interface BudgetView {
  day: string;
  tokenCap: number | null;
  tokensToday: number;
  tokenPct: number | null;
  costCapUsd: number | null;
  /** Known cost today; see `costComplete`. Null when nothing could be priced. */
  costTodayUsd: number | null;
  costComplete: boolean;
  costPct: number | null;
  state: 'no_caps' | 'within' | 'over_tokens' | 'over_cost' | 'cost_unknown' | 'controls_unknown';
}

/** The configured daily caps against today's observed use (UTC day). */
export function budgetView(controls: AiControls | null, controlsKnown: boolean, today: AiOpsReport['today']): BudgetView {
  const tokenCap = controls?.dailyTokenCap ?? null;
  const costCapUsd = controls?.dailyCostCapUsd ?? null;
  const costTodayUsd = today.cost.usd;
  const tokenPct = tokenCap ? Math.round((today.tokens / tokenCap) * 100) : null;
  const costPct = costCapUsd && costTodayUsd !== null ? Math.round((costTodayUsd / costCapUsd) * 100) : null;
  let state: BudgetView['state'];
  if (!controlsKnown) state = 'controls_unknown';
  else if (tokenCap === null && costCapUsd === null) state = 'no_caps';
  else if (tokenCap !== null && today.tokens >= tokenCap) state = 'over_tokens';
  else if (costCapUsd !== null && costTodayUsd !== null && costTodayUsd >= costCapUsd) state = 'over_cost';
  else if (costCapUsd !== null && !today.cost.complete) state = 'cost_unknown';
  else state = 'within';
  return { day: today.day, tokenCap, tokensToday: today.tokens, tokenPct, costCapUsd, costTodayUsd, costComplete: today.cost.complete, costPct, state };
}

interface ConfigRow { key: string; value: unknown; updated_at: string | null }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const cols = 'created_at,feature,model,ok,status,error,latency_ms';
  const query = (select: string) => `created_at=gte.${encodeURIComponent(since)}&select=${select}&order=created_at.desc&limit=${ROW_CAP}`;
  const [first, cfg] = await Promise.all([
    sbSelectResult<AiOpsRow>(env, 'vinax_ai_events', query(`${cols},prompt_tokens,completion_tokens`)),
    sbSelectResult<ConfigRow>(env, 'vinax_config', `key=in.(${encodeURIComponent('"ai-controls","ai-prices"')})&select=key,value,updated_at`),
  ]);
  // The token columns arrive with a later migration; without them the read is
  // a 400 — fall back to the bare columns and say that tokens are not recorded.
  let events = first;
  let tokenColumns = true;
  if (!first.ok && first.error === 'bad_request') {
    events = await sbSelectResult<AiOpsRow>(env, 'vinax_ai_events', query(cols));
    tokenColumns = false;
  }
  if (!events.ok) return json({ configured: true, error: dbErrorCode(events.error), upstreamStatus: events.httpStatus }, 502);

  const byKey = new Map((cfg.ok ? cfg.rows : []).map((r) => [r.key, r]));
  const prices = cfg.ok ? parsePrices(byKey.get('ai-prices')?.value) : null;
  const controlsRow = byKey.get('ai-controls');
  const controls = cfg.ok ? parseAiControls(controlsRow?.value) : null;
  const report = aggregateAiOps(events.rows, prices);
  return json({
    configured: true,
    days,
    sampled: events.rows.length,
    truncated: events.rows.length >= ROW_CAP,
    tokenColumns,
    ...report,
    controls: {
      read: cfg.ok ? 'ok' : 'failed',
      ...(cfg.ok ? {} : { error: dbErrorCode(cfg.error) }),
      published: !!controls,
      value: controls,
      rowUpdatedAt: controlsRow?.updated_at ?? null,
    },
    budget: budgetView(controls, cfg.ok, report.today),
    prices: { read: cfg.ok ? 'ok' : 'failed', configured: prices ? Object.keys(prices).length > 0 : null },
    controlFeatures: AI_CONTROL_FEATURES,
  });
};
