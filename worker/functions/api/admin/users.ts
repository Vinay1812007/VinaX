/** User Management: paginated + searchable user list with summary counts. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpc, sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface UserRow {
  device_id: string;
  name: string | null;
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
  if (!isAdmin(request, env)) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  // PostgREST treats , ( ) as or=() filter syntax and * % as wildcards —
  // strip them so a crafted q can't reshape the filter (defense-in-depth,
  // DQA-17; the route is already admin-only).
  const q = (url.searchParams.get('q') ?? '').replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

  let query =
    'select=device_id,name,platform,country,city,is_playing,first_seen,last_seen' +
    `&order=last_seen.desc&limit=${limit}&offset=${offset}`;
  if (q) query += `&or=(name.ilike.*${encodeURIComponent(q)}*,device_id.ilike.*${encodeURIComponent(q)}*)`;

  const [users, summary] = await Promise.all([
    sbSelect<UserRow>(env, 'vinax_users', query),
    sbRpc<Summary>(env, 'vinax_user_summary', {}),
  ]);

  return new Response(JSON.stringify({ users, summary: summary ?? null, limit, offset }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
