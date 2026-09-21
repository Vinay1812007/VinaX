/** Real-time pulse: starts/min, joins, live listeners + cities, errors (5m),
 *  AI latency (15m), active rooms. Designed for 5-10s polling. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) {
    // Unchanged pre-7.2 shape for an unconfigured Worker (plus the flag).
    return adminJson({ configured: false, startsPerMin: 0, joins5m: 0, errors5m: 0, recentErrors: [], liveListeners: 0, liveCities: [], aiP50: 0, aiOkRate: null, aiCalls15m: 0, activeRooms: 0 });
  }
  const m1 = new Date(Date.now() - 60_000).toISOString();
  const m5 = new Date(Date.now() - 5 * 60_000).toISOString();
  const m15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const [starts, joins, errors, live, ai, rooms] = await Promise.all([
    sbSelectResult<{ id: number }>(env, 'vinax_events', `type=eq.play&created_at=gte.${encodeURIComponent(m1)}&select=id&limit=500`),
    sbSelectResult<{ device_id: string }>(env, 'vinax_users', `first_seen=gte.${encodeURIComponent(m5)}&select=device_id&limit=200`),
    sbSelectResult<{ error_kind: string | null; message: string | null; created_at: string }>(
      env, 'vinax_events', `type=eq.error&created_at=gte.${encodeURIComponent(m5)}&select=error_kind,message,created_at&order=created_at.desc&limit=10`,
    ),
    sbSelectResult<{ name: string | null; city: string | null; country: string | null; current_song_title: string | null }>(
      env, 'vinax_users', `last_seen=gte.${encodeURIComponent(m5)}&select=name,city,country,current_song_title&limit=100`,
    ),
    sbSelectResult<{ latency_ms: number | null; ok: boolean }>(
      env, 'vinax_ai_events', `created_at=gte.${encodeURIComponent(m15)}&select=latency_ms,ok&limit=200`,
    ),
    sbSelectResult<{ code: string; updated_at: string }>(
      env, 'vinax_rooms', `updated_at=gte.${encodeURIComponent(m5)}&select=code,updated_at&limit=50`,
    ),
  ]);
  // 7.2.0 — a pulse built from a failed read would report "nobody listening";
  // any failed read makes the pulse unavailable instead.
  for (const r of [starts, joins, errors, live, ai, rooms]) if (!r.ok) return dbFailure(r);
  const lat = ai.rows.map((a) => a.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  const aiOk = ai.rows.length ? Math.round((ai.rows.filter((a) => a.ok).length / ai.rows.length) * 100) : null;
  return adminJson({
    configured: true,
    startsPerMin: starts.rows.length,
    joins5m: joins.rows.length,
    errors5m: errors.rows.length,
    recentErrors: errors.rows,
    liveListeners: live.rows.length,
    liveCities: live.rows,
    // No AI call with a latency in the window → unknown, not 0 ms.
    aiP50: p50,
    aiOkRate: aiOk,
    aiCalls15m: ai.rows.length,
    activeRooms: rooms.rows.length,
  });
};
