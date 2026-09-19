/** Admin: latest in-app feedback / bug reports. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, sbUpdate, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface FeedbackRow {
  id: number;
  type: string | null;
  name: string | null;
  message: string | null;
  app_version: string | null;
  platform: string | null;
  country: string | null;
  city: string | null;
  status: string | null;
  created_at: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  if (!supabaseConfigured(env)) return adminJson({ configured: false, feedback: [] });
  const read = await sbSelectResult<FeedbackRow>(
    env,
    'vinax_feedback',
    'select=id,type,name,message,app_version,platform,country,city,status,created_at&type=neq.admin-audit&order=created_at.desc&limit=200',
  );

  // 7.2.0 — a failed read is not an empty inbox.
  if (!read.ok) return dbFailure(read);
  return adminJson({ configured: true, feedback: read.rows });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const body = (await request.json().catch(() => null)) as { id?: number; status?: string } | null;
  const id = body && typeof body.id === 'number' ? body.id : null;
  if (id === null) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const status = body && typeof body.status === 'string' ? body.status.slice(0, 16) : 'resolved';
  const ok = await sbUpdate(env, 'vinax_feedback', `id=eq.${id}`, { status });

  // A failed Supabase write is a SERVER problem, not the client's (D-17).
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
