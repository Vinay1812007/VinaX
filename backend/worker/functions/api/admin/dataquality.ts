/**
 * Package E13 — Data Quality: one glance, one health number.
 *
 * Four signal percentages over the newest samples (caps keep reads bounded,
 * same pattern as the weekly digest — on busy days these are estimates over
 * the freshest N rows, and the payload says how many were sampled):
 *   1. play events with a verified origin
 *   2. play events with a resolved country
 *   3. AI calls that succeeded
 *   4. AI calls that produced content (not empty)
 * The composite score is their plain mean. Each query fails soft on its own
 * (a missing column 400s that select alone → its metric reads null, the rest
 * keep working).
 */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const SAMPLE = 5000;

function pct(n: number, total: number): number | null {
  return total > 0 ? Math.round((n / total) * 100) : null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  if (!supabaseConfigured(env)) {
    return adminJson({ configured: false, score: null, metrics: { originVerifiedPct: null, countryResolvedPct: null, aiOkPct: null, aiContentPct: null }, slos: [], sampled: { events: 0, aiEvents: 0 } });
  }
  const [eventsRead, aiRead] = await Promise.all([
    sbSelectResult<{ origin_verified: boolean | null; country: string | null }>(
      env,
      'vinax_events',
      // type=play: the metrics are defined over PLAY events; sampling every
      // event type (vitals, errors, admin markers) skewed both percentages (D-8).
      `select=origin_verified,country&type=eq.play&order=created_at.desc&limit=${SAMPLE}`,
    ),
    sbSelectResult<{ ok: boolean | null; error: string | null }>(
      env,
      'vinax_ai_events',
      `select=ok,error&order=created_at.desc&limit=${SAMPLE}`,
    ),
  ]);
  // 7.2.0 — the two samples are independent: a failed one makes ITS metrics
  // and sample size null (named in `unavailable`), never 0. Both failed → 502.
  if (!eventsRead.ok && !aiRead.ok) return dbFailure(eventsRead, { unavailable: ['events', 'aiEvents'] });
  const unavailable = [...(eventsRead.ok ? [] : ['events']), ...(aiRead.ok ? [] : ['aiEvents'])];
  const events = eventsRead.rows;
  const aiEvents = aiRead.rows;

  const originPct = eventsRead.ok ? pct(events.filter((e) => e.origin_verified === true).length, events.length) : null;
  const countryPct = eventsRead.ok ? pct(events.filter((e) => !!e.country).length, events.length) : null;
  const aiOkPct = aiRead.ok ? pct(aiEvents.filter((e) => e.ok === true).length, aiEvents.length) : null;
  // Content delivered = the call SUCCEEDED and carried no error marker.
  // `error !== 'empty'` alone counted failed/not_configured/empty_stream_fallback
  // rows as delivered content, structurally over-reporting the SLO (D-9).
  const aiContentPct = aiRead.ok ? pct(aiEvents.filter((e) => e.ok === true && !e.error).length, aiEvents.length) : null;

  const parts = [originPct, countryPct, aiOkPct, aiContentPct].filter((v): v is number => v != null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  // Infra §6 — error-budget SLOs (targets documented in docs/operations.md).
  // Budget burned = failure observed / failure allowed; >100% = SLO breached.
  const slo = (name: string, targetPct: number, actualPct: number | null) => ({
    name,
    targetPct,
    actualPct,
    budgetBurnedPct:
      actualPct == null ? null : Math.min(999, Math.round(((100 - actualPct) / (100 - targetPct)) * 100)),
  });

  return adminJson({
      configured: true,
      score,
      metrics: {
        originVerifiedPct: originPct,
        countryResolvedPct: countryPct,
        aiOkPct,
        aiContentPct,
      },
      slos: [
        slo('AI success', 98, aiOkPct),
        slo('AI content delivery', 99, aiContentPct),
      ],
      sampled: { events: eventsRead.ok ? events.length : null, aiEvents: aiRead.ok ? aiEvents.length : null },
      unavailable,
  });
};
