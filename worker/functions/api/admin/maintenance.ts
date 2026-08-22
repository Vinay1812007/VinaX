/** Admin maintenance: destructive Supabase actions, each explicit + audited
 *  by the admin UI's confirm dialogs. Token-gated like every admin route. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { methodNotAllowed } from '../../_lib/ratelimit';
import { sbDelete, sbInsert, type SupabaseEnv } from '../../_lib/supabase';

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
    const id = typeof body?.device_id === 'string' ? body.device_id : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    if (!id) return json({ error: 'bad_request' }, 400);
    if (reason.length < 3) return json({ error: 'reason_required' }, 400);
    const okEvents = await sbDelete(env, 'vinax_events', `device_id=eq.${encodeURIComponent(id)}`);
    const okUser = await sbDelete(env, 'vinax_users', `device_id=eq.${encodeURIComponent(id)}`);
    if (okEvents && okUser) {
      // Permanent audit note — written only once the deletion actually succeeded.
      await sbInsert(env, 'vinax_feedback', {
        device_id: id,
        name: 'Admin',
        type: 'admin-audit',
        message: `Deleted user ${id.slice(0, 12)}…: ${reason}`,
        status: 'resolved',
      }).catch(() => false);
    }
    return json({ ok: okEvents && okUser });
  }
  if (action === 'purge_events') {
    if (!days) return json({ error: 'bad_request' }, 400);
    return json({ ok: await sbDelete(env, 'vinax_events', `created_at=lt.${encodeURIComponent(cutoff)}`) });
  }
  if (action === 'clear_errors') {
    return json({ ok: await sbDelete(env, 'vinax_events', 'type=eq.error') });
  }
  if (action === 'trim_ai') {
    if (!days) return json({ error: 'bad_request' }, 400);
    return json({ ok: await sbDelete(env, 'vinax_ai_events', `created_at=lt.${encodeURIComponent(cutoff)}`) });
  }
  if (action === 'clear_feedback') {
    return json({ ok: await sbDelete(env, 'vinax_feedback', 'status=eq.resolved') });
  }
  if (action === 'close_rooms') {
    const a = await sbDelete(env, 'vinax_room_members', ALL);
    const b = await sbDelete(env, 'vinax_rooms', ALL);
    return json({ ok: a && b });
  }
  if (action === 'end_room') {
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!code) return json({ error: 'bad_request' }, 400);
    const a = await sbDelete(env, 'vinax_room_members', `code=eq.${encodeURIComponent(code)}`);
    const b = await sbDelete(env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}`);
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
