/** AI Monitoring: request volume, success rate, models, latency, errors, recent. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  if (!supabaseConfigured(env)) return adminJson({ configured: false, days, metrics: null });
  const metrics = await sbRpcResult<Record<string, unknown>>(env, 'vinax_ai_metrics', { p_days: days });
  // 7.2.0 — a failed read answers 502; `metrics: null` now only means the
  // function returned nothing.
  if (!metrics.ok) return dbFailure(metrics);
  return adminJson({ configured: true, days, metrics: metrics.value ?? null });
};
