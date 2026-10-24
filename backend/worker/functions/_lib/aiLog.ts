/**
 * The AI call log — one `ai_calls` row per model call: feature, lane,
 * provider, model, outcome, latency and token counts. Never the prompt, never
 * the answer. Feeds the console's VinaX AI usage page and the daily spend caps.
 *
 * Best effort: a failed write is logged once per minute and never affects
 * the call it describes. With `waitUntil` the write outlives the response.
 */
import { db, type DbEnv } from './db';

export interface AiCall {
  feature: string;
  lane?: string | null;
  provider?: string | null;
  model?: string | null;
  ok: boolean;
  status?: number | null;
  error?: string | null;
  client?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
let lastWarn = 0;

export function logAiCall(env: DbEnv, call: AiCall, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  const row = {
    feature: clip(call.feature, 40) ?? 'unknown',
    lane: clip(call.lane, 40),
    provider: clip(call.provider, 40),
    model: clip(call.model, 120),
    ok: call.ok === true,
    status: int(call.status),
    error: clip(call.error, 120),
    client: clip(call.client, 20),
    latency_ms: int(call.latencyMs),
    prompt_tokens: int(call.promptTokens),
    completion_tokens: int(call.completionTokens),
  };
  const write = db.insert(env, 'ai_calls', row).then((r) => {
    if (!r.ok && r.error !== 'not_configured' && Date.now() - lastWarn > 60_000) {
      lastWarn = Date.now();
      console.warn(`[ai] call log failed (${r.error}${r.status ? ` ${r.status}` : ''})`);
    }
  }).catch(() => undefined);
  if (waitUntil) {
    waitUntil(write);
    return Promise.resolve();
  }
  return write;
}

/** The client kind a request came from (`x-vinax-client` or platform header), for the log. */
export function clientOf(request: Request | undefined): string {
  const c = request?.headers.get('x-vinax-client') ?? request?.headers.get('x-vinax-platform') ?? '';
  return /^[a-z]{2,20}$/i.test(c) ? c.toLowerCase() : 'web';
}
