/** Real-time pulse: starts/min, joins, live listeners + cities, errors (5m),
 *  AI latency (15m), active rooms. Designed for 5-10s polling. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const m1 = new Date(Date.now() - 60_000).toISOString();
  const m5 = new Date(Date.now() - 5 * 60_000).toISOString();
  const m15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const [starts, joins, errors, live, ai, rooms] = await Promise.all([
    dbSelect<{ id: number }>(env, 'vinax_events', `type=eq.play&created_at=gte.${encodeURIComponent(m1)}&select=id&limit=500`),
    dbSelect<{ device_id: string }>(env, 'vinax_users', `first_seen=gte.${encodeURIComponent(m5)}&select=device_id&limit=200`),
    dbSelect<{ error_kind: string | null; message: string | null; created_at: string }>(
      env, 'vinax_events', `type=eq.error&created_at=gte.${encodeURIComponent(m5)}&select=error_kind,message,created_at&order=created_at.desc&limit=10`,
    ),
    dbSelect<{ name: string | null; city: string | null; country: string | null; current_song_title: string | null }>(
      env, 'vinax_users', `last_seen=gte.${encodeURIComponent(m5)}&select=name,city,country,current_song_title&limit=100`,
    ),
    dbSelect<{ latency_ms: number | null; ok: boolean }>(
      env, 'vinax_ai_events', `created_at=gte.${encodeURIComponent(m15)}&select=latency_ms,ok&limit=200`,
    ),
    dbSelect<{ code: string; updated_at: string }>(
      env, 'vinax_rooms', `updated_at=gte.${encodeURIComponent(m5)}&select=code,updated_at&limit=50`,
    ),
  ]);
  const lat = ai.map((a) => a.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const aiOk = ai.length ? Math.round((ai.filter((a) => a.ok).length / ai.length) * 100) : null;
  return new Response(
    JSON.stringify({
      startsPerMin: starts.length,
      joins5m: joins.length,
      errors5m: errors.length,
      recentErrors: errors,
      liveListeners: live.length,
      liveCities: live,
      aiP50: p50,
      aiOkRate: aiOk,
      aiCalls15m: ai.length,
      activeRooms: rooms.length,
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
