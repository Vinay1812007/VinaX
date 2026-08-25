/** Sent-notification log: announcements + daily song pushes, with retract. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { dbDeleteReturning, dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const rows = await dbSelect<{ type: string; message: string | null; created_at: string; city: string | null; region: string | null; country: string | null; song_title: string | null; language: string | null }>(
    env,
    'vinax_events',
    'type=in.(announcement,song-push,ai-push)&select=type,message,created_at,city,region,country,song_title,language&order=created_at.desc&limit=30',
  ).catch(() => []);
  return json({ rows });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { action?: string; created_at?: string } | null;
  if (body?.action !== 'retract' || typeof body.created_at !== 'string') return json({ error: 'bad_request' }, 400);
  // Audit finding M-SRV-9: dbDelete returned true even when zero rows were
  // deleted, so a mistyped created_at silently reported "ok" to the admin.
  // Use the returning variant and surface the row count instead.
  const rows = await dbDeleteReturning<{ created_at: string }>(
    env,
    'vinax_events',
    // Match every type the GET lists — retracting a song-push/ai-push row
    // used to 404 because only announcements were deletable (D-25).
    `device_id=eq.admin&type=in.(announcement,song-push,ai-push)&created_at=eq.${encodeURIComponent(body.created_at)}`,
  );
  if (rows === null) return json({ ok: false, error: 'delete_failed' }, 500);
  if (rows.length === 0) return json({ ok: false, error: 'not_found' }, 404);
  // E12 — retractions are mutations too; leave a row (best-effort).
  void logAdminAudit(env, 'notify-retract', `notification @ ${body.created_at}`);
  return json({ ok: true, deleted: rows.length });
};
