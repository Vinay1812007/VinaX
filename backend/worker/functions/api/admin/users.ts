/** User Management: paginated + searchable user list with summary counts. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface UserRow {
  device_id: string;
  name: string | null;
  username?: string | null;
  platform: string | null;
  country: string | null;
  city: string | null;
  is_playing: boolean | null;
  first_seen: string;
  last_seen: string;
}
interface Summary { total_users: number; active_24h: number; new_24h: number; total_plays: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  // PostgREST treats , ( ) as or=() filter syntax and * % as wildcards —
  // strip them so a crafted q can't reshape the filter (defense-in-depth,
  // DQA-17; the route is already admin-only).
  const q = (url.searchParams.get('q') ?? '').replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

  let query =
    'select=device_id,name,username,platform,country,city,is_playing,first_seen,last_seen' +
    // limit+1: the extra row is a cheap, exact hasMore signal — the UI used
    // to infer it from rows.length >= limit, which shows a Next button that
    // lands on an empty page whenever the last page is exactly full (D-22).
    `&order=last_seen.desc&limit=${limit + 1}&offset=${offset}`;
  if (q) query += `&or=(name.ilike.*${encodeURIComponent(q)}*,username.ilike.*${encodeURIComponent(q)}*,device_id.ilike.*${encodeURIComponent(q)}*)`;

  if (!supabaseConfigured(env)) return adminJson({ configured: false, users: [], summary: null, limit, offset, hasMore: false });
  const [read, summary] = await Promise.all([
    sbSelectResult<UserRow>(env, 'vinax_users', query),
    sbRpcResult<Summary>(env, 'vinax_user_summary', {}),
  ]);
  // 7.2.0 — a failed read is not "no users": the list and its counts are
  // unavailable together.
  if (!read.ok) return dbFailure(read);
  if (!summary.ok) return dbFailure(summary);

  const users = read.rows;
  const hasMore = users.length > limit;
  if (hasMore) users.length = limit;
  return adminJson({ configured: true, users, summary: summary.value ?? null, limit, offset, hasMore });
};
