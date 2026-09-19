/**
 * Package E1 — weekly cohort retention for the Engagement dashboard.
 * Thin wrapper over the vinax_retention RPC (see the delivered migration);
 * answers { configured: false } until the RPC exists so the panel can say
 * "run the migration" instead of erroring.
 */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

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
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, cohorts: [] });
  const rows = await sbRpcResult<CohortRow[]>(env, 'vinax_retention', { p_weeks: 8 });
  // A missing function (404) is the documented "run the migration" state;
  // any other failure is an outage and answers 502 (7.2.0), not configured:false.
  if (!rows.ok) return rows.error === 'not_found' ? adminJson({ configured: false, cohorts: [] }) : dbFailure(rows);
  return adminJson({ configured: true, cohorts: rows.value ?? [] });
};
