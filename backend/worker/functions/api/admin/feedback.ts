/** Admin: latest in-app feedback / bug reports. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, dbUpdate, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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

  const feedback = await dbSelect<FeedbackRow>(
    env,
    'vinax_feedback',
    'select=id,type,name,message,app_version,platform,country,city,status,created_at&type=neq.admin-audit&order=created_at.desc&limit=200',
  );

  return new Response(JSON.stringify({ feedback }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
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
  const ok = await dbUpdate(env, 'vinax_feedback', `id=eq.${id}`, { status });

  // A failed database write is a SERVER problem, not the client's (D-17).
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
