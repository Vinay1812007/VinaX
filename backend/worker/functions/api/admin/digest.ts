/** Latest weekly digest row for the Overview card. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, digest: null, created_at: null });
  const read = await sbSelectResult<{ message: string | null; created_at: string }>(
    env,
    'vinax_events',
    'type=eq.weekly-digest&select=message,created_at&order=created_at.desc&limit=1',
  );
  // 7.2.0 — "no digest yet" and "could not read the digest" are different.
  if (!read.ok) return dbFailure(read);
  const rows = read.rows;
  let digest: unknown;
  try {
    digest = rows[0]?.message ? (JSON.parse(rows[0].message) as unknown) : null;
  } catch {
    digest = null;
  }
  return adminJson({ configured: true, digest, created_at: rows[0]?.created_at ?? null });
};
