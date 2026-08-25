/** AI Monitoring: request volume, success rate, models, latency, errors, recent. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbRpc, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const metrics = await dbRpc<Record<string, unknown>>(env, 'vinax_ai_metrics', { p_days: days });
  return new Response(JSON.stringify({ days, metrics: metrics ?? null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
