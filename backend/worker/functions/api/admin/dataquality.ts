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
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

const SAMPLE = 5000;

function pct(n: number, total: number): number | null {
  return total > 0 ? Math.round((n / total) * 100) : null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const [events, aiEvents] = await Promise.all([
    dbSelect<{ origin_verified: boolean | null; country: string | null }>(
      env,
      'vinax_events',
      // type=play: the metrics are defined over PLAY events; sampling every
      // event type (vitals, errors, admin markers) skewed both percentages (D-8).
      `select=origin_verified,country&type=eq.play&order=created_at.desc&limit=${SAMPLE}`,
    ),
    dbSelect<{ ok: boolean | null; error: string | null }>(
      env,
      'vinax_ai_events',
      `select=ok,error&order=created_at.desc&limit=${SAMPLE}`,
    ),
  ]);

  const originPct = pct(events.filter((e) => e.origin_verified === true).length, events.length);
  const countryPct = pct(events.filter((e) => !!e.country).length, events.length);
  const aiOkPct = pct(aiEvents.filter((e) => e.ok === true).length, aiEvents.length);
  // Content delivered = the call SUCCEEDED and carried no error marker.
  // `error !== 'empty'` alone counted failed/not_configured/empty_stream_fallback
  // rows as delivered content, structurally over-reporting the SLO (D-9).
  const aiContentPct = pct(aiEvents.filter((e) => e.ok === true && !e.error).length, aiEvents.length);

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

  return new Response(
    JSON.stringify({
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
      sampled: { events: events.length, aiEvents: aiEvents.length },
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
