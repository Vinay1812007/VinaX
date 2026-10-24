/**
 * The owner's AI controls — the `ai-controls` setting, enforced on every
 * model call:
 *
 *   { emergencyOff: boolean,              every AI feature answers 503 ai_disabled
 *     features: { [name]: boolean },      one feature off (chat, dj, playlist, search, home, title…)
 *     dailyTokenCap: number }             prompt + completion tokens per UTC day,
 *                                         summed from ai_calls; over it → 503 ai_over_budget
 *
 * Both answers are shapes the apps already treat as "AI is unavailable here".
 * The usage sum is read once a minute per isolate (ai_usage_since), so the
 * cap is approximate by at most a minute of traffic.
 */
import { db, type DbEnv } from './db';
import { setting } from './settings';

export type AiRefusal = 'ai_disabled' | 'ai_over_budget';

export interface AiControls {
  emergencyOff: boolean;
  features: Record<string, boolean>;
  dailyTokenCap: number | null;
}

export function parseAiControls(raw: unknown): AiControls {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const features: Record<string, boolean> = {};
  const f = o.features && typeof o.features === 'object' && !Array.isArray(o.features) ? (o.features as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(f)) if (/^[a-z][a-z0-9_-]{0,39}$/i.test(k) && typeof v === 'boolean') features[k] = v;
  const cap = typeof o.dailyTokenCap === 'number' && Number.isFinite(o.dailyTokenCap) && o.dailyTokenCap > 0 ? Math.floor(o.dailyTokenCap) : null;
  return { emergencyOff: o.emergencyOff === true, features, dailyTokenCap: cap };
}

/** `chat:expert` → `chat`; `dj` → `dj`. */
export const featureName = (feature: string): string => feature.split(':')[0].toLowerCase();

interface UsageRow { promptTokens: number; completionTokens: number }
let usageMemo: { at: number; day: string; tokens: number } | null = null;
const USAGE_MEMO_MS = 60_000;

/** Tests only. */
export function resetAiControlsMemo(): void {
  usageMemo = null;
}

/** Tokens spent today (UTC) across every model, or null when unreadable. */
export async function tokensToday(env: DbEnv, now = Date.now()): Promise<number | null> {
  const day = new Date(now).toISOString().slice(0, 10);
  if (usageMemo && usageMemo.day === day && now - usageMemo.at < USAGE_MEMO_MS) return usageMemo.tokens;
  const r = await db.rpc<UsageRow[]>(env, 'ai_usage_since', { p_since: `${day}T00:00:00.000Z` });
  if (!r.ok || !Array.isArray(r.value)) return null;
  const tokens = r.value.reduce((n, row) => n + (Number(row.promptTokens) || 0) + (Number(row.completionTokens) || 0), 0);
  usageMemo = { at: now, day, tokens };
  return tokens;
}

/** Why this call must not run, or null when it may. Never throws; no database = no controls. */
export async function aiRefusal(env: DbEnv, feature: string, now = Date.now()): Promise<AiRefusal | null> {
  try {
    const controls = parseAiControls(await setting(env, 'ai-controls', now));
    if (controls.emergencyOff) return 'ai_disabled';
    if (controls.features[featureName(feature)] === false) return 'ai_disabled';
    if (controls.dailyTokenCap !== null) {
      const spent = await tokensToday(env, now);
      if (spent !== null && spent >= controls.dailyTokenCap) return 'ai_over_budget';
    }
    return null;
  } catch {
    return null;
  }
}

/** The 503 every AI route answers when refused. */
export function refusalResponse(refusal: AiRefusal, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: refusal }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
