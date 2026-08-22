/** Sent-notification log: announcements + daily song pushes, with retract. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbDeleteReturning, sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rows = await sbSelect<{ type: string; message: string | null; created_at: string }>(
    env,
    'vinax_events',
    'type=in.(announcement,song-push)&select=type,message,created_at&order=created_at.desc&limit=20',
  ).catch(() => []);
  return json({ rows });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { action?: string; created_at?: string } | null;
  if (body?.action !== 'retract' || typeof body.created_at !== 'string') return json({ error: 'bad_request' }, 400);
  // Audit finding M-SRV-9: sbDelete returned true even when zero rows were
  // deleted, so a mistyped created_at silently reported "ok" to the admin.
  // Use the returning variant and surface the row count instead.
  const rows = await sbDeleteReturning<{ created_at: string }>(
    env,
    'vinax_events',
    `device_id=eq.admin&type=eq.announcement&created_at=eq.${encodeURIComponent(body.created_at)}`,
  );
  if (rows === null) return json({ ok: false, error: 'delete_failed' }, 500);
  if (rows.length === 0) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, deleted: rows.length });
};
