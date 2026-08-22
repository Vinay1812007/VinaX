/** Admin maintenance: destructive Supabase actions, each explicit + audited
 *  by the admin UI's confirm dialogs. Token-gated like every admin route. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { methodNotAllowed } from '../../_lib/ratelimit';
import { sbDelete, sbDeleteReturning, sbInsert, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed('POST');

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const days = typeof body?.days === 'number' && body.days > 0 ? Math.floor(body.days) : 0;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const ALL = 'created_at=gte.1970-01-01';

  if (action === 'delete_user') {
    const id = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
    // Strip `|` — the audit trail packs `kind|text` into one column, so a pipe
    // in the reason would let free text masquerade as the audit KIND (D-6).
    const reason =
      typeof body?.reason === 'string' ? body.reason.replace(/\|/g, '/').trim().slice(0, 300) : '';
    if (!id || id.length > 128) return json({ error: 'bad_request' }, 400);
    if (reason.length < 3) return json({ error: 'reason_required' }, 400);
    const okEvents = await sbDelete(env, 'vinax_events', `device_id=eq.${encodeURIComponent(id)}`);
    // Returning delete so a typo'd / already-deleted device_id is an honest
    // not_found instead of a silent `{ok:true}` no-op (D-18).
    const removed = await sbDeleteReturning<{ device_id: string }>(
      env,
      'vinax_users',
      `device_id=eq.${encodeURIComponent(id)}&select=device_id`,
    );
    if (removed === null) return json({ ok: false, error: 'delete_failed' }, 500);
    if (removed.length === 0) return json({ ok: false, error: 'not_found' }, 404);
    // Best-effort cleanup of remaining references so the deletion doesn't
    // leave the device lingering in rooms it once joined (orphan audit).
    await sbDelete(env, 'vinax_room_members', `device_id=eq.${encodeURIComponent(id)}`);
    // Scrub the identifier from any feedback the device filed — deleting a
    // user must not keep their device_id alive in another table (D-4).
    await sbUpdate(env, 'vinax_feedback', `device_id=eq.${encodeURIComponent(id)}`, { device_id: 'deleted' });
    // Permanent audit note — written via the audit channel (status never
    // 'new', never 'resolved': it must not inflate the feedback KPI and must
    // survive clear_feedback). Only the truncated id is recorded.
    await logAdminAudit(env, 'user-delete', `Deleted user ${id.slice(0, 12)}…: ${reason}`);
    return json({ ok: okEvents });
  }
  if (action === 'purge_events') {
    if (!days) return json({ error: 'bad_request' }, 400);
    const ok = await sbDelete(env, 'vinax_events', `created_at=lt.${encodeURIComponent(cutoff)}`);
    if (ok) await logAdminAudit(env, 'maintenance', `Purged events older than ${days}d`);
    return json({ ok });
  }
  if (action === 'clear_errors') {
    const ok = await sbDelete(env, 'vinax_events', 'type=eq.error');
    if (ok) await logAdminAudit(env, 'maintenance', 'Cleared error events');
    return json({ ok });
  }
  if (action === 'trim_ai') {
    if (!days) return json({ error: 'bad_request' }, 400);
    const ok = await sbDelete(env, 'vinax_ai_events', `created_at=lt.${encodeURIComponent(cutoff)}`);
    if (ok) await logAdminAudit(env, 'maintenance', `Trimmed AI events older than ${days}d`);
    return json({ ok });
  }
  if (action === 'clear_feedback') {
    // Never delete audit rows — one destructive admin action must not erase
    // the permanent record of another (D-4).
    const ok = await sbDelete(env, 'vinax_feedback', 'status=eq.resolved&type=neq.admin-audit');
    if (ok) await logAdminAudit(env, 'maintenance', 'Cleared resolved feedback');
    return json({ ok });
  }
  if (action === 'close_rooms') {
    // vinax_room_members has NO created_at column — the old filter 400'd and
    // silently orphaned every member row while still nuking the rooms (D-2).
    const a = await sbDelete(env, 'vinax_room_members', 'last_seen=gte.1970-01-01');
    const b = await sbDelete(env, 'vinax_rooms', ALL);
    if (a && b) await logAdminAudit(env, 'maintenance', 'Closed all rooms');
    return json({ ok: a && b });
  }
  if (action === 'end_room') {
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!code) return json({ error: 'bad_request' }, 400);
    const a = await sbDelete(env, 'vinax_room_members', `code=eq.${encodeURIComponent(code)}`);
    const b = await sbDelete(env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}`);
    if (a && b) await logAdminAudit(env, 'maintenance', `Ended room ${code.slice(0, 12)}`);
    return json({ ok: a && b });
  }
  if (action === 'site_mode') {
    const mode = body?.mode === 'maintenance' ? 'maintenance' : 'live';
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const ok = await sbInsert(env, 'vinax_events', {
      device_id: 'admin',
      type: 'site-mode',
      message: `${mode}|${note}`,
    });
    return json({ ok, mode });
  }

  return json({ error: 'unknown_action' }, 400);
};
