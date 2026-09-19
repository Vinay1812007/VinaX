/** New listeners per day (last 28d) for the Overview growth card. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, days: new Array(14).fill(0), last14: 0, prev14: 0, sampled: false });
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const read = await sbSelectResult<{ first_seen: string }>(
    env,
    'vinax_users',
    `first_seen=gte.${encodeURIComponent(since)}&select=first_seen&limit=5000`,
  );
  // 7.2.0 — a failed read would draw a flat line of zero sign-ups.
  if (!read.ok) return dbFailure(read);
  const rows = read.rows;
  const buckets = new Array(28).fill(0) as number[];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const r of rows) {
    const diff = Math.floor((today.getTime() - new Date(r.first_seen).setUTCHours(0, 0, 0, 0)) / 86_400_000);
    if (diff >= 0 && diff < 28) buckets[27 - diff] += 1;
  }
  const last14 = buckets.slice(14).reduce((a, b) => a + b, 0);
  const prev14 = buckets.slice(0, 14).reduce((a, b) => a + b, 0);
  return adminJson({ configured: true, days: buckets.slice(14), last14, prev14, sampled: rows.length >= 5000 });
};
