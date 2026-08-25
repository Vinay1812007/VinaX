/** User Management: paginated + searchable user list with summary counts. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbRpc, dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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
  if (!isAdmin(request, env)) return unauthorized();

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

  const [users, summary] = await Promise.all([
    dbSelect<UserRow>(env, 'vinax_users', query),
    dbRpc<Summary>(env, 'vinax_user_summary', {}),
  ]);

  const hasMore = users.length > limit;
  if (hasMore) users.length = limit;
  return new Response(JSON.stringify({ users, summary: summary ?? null, limit, offset, hasMore }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
