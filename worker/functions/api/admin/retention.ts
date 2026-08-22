/**
 * Package E1 — weekly cohort retention for the Engagement dashboard.
 * Thin wrapper over the vinax_retention RPC (see the delivered migration);
 * answers { configured: false } until the RPC exists so the panel can say
 * "run the migration" instead of erroring.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpc, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface CohortRow {
  cohort_week: string;
  cohort_size: number;
  d1: number;
  d7: number;
  d30: number;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rows = await sbRpc<CohortRow[]>(env, 'vinax_retention', { p_weeks: 8 });
  return new Response(
    JSON.stringify(rows === null ? { configured: false, cohorts: [] } : { configured: true, cohorts: rows }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
