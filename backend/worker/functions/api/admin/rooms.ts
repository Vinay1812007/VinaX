/** Live Listen Together rooms: active rooms, member counts, now playing. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  const memSince = new Date(Date.now() - 60_000).toISOString();
  const [rooms, members] = await Promise.all([
    sbSelect<{ code: string; host_name: string | null; song: unknown; playing: boolean; updated_at: string }>(
      env,
      'vinax_rooms',
      `updated_at=gte.${encodeURIComponent(since)}&select=code,host_name,song,playing,updated_at&order=updated_at.desc&limit=50`,
    ),
    sbSelect<{ code: string }>(
      env,
      'vinax_room_members',
      `last_seen=gte.${encodeURIComponent(memSince)}&select=code&limit=2000`, // bounded like every other admin read (D-12)
    ),
  ]);
  const counts: Record<string, number> = {};
  for (const m of members) counts[m.code] = (counts[m.code] ?? 0) + 1;
  const list = rooms.map((r) => {
    const raw = r.song as { v?: number; current?: { title?: string; subtitle?: string } } | { title?: string; subtitle?: string } | null;
    const cur =
      raw && typeof raw === 'object' && 'current' in raw
        ? ((raw as { current?: { title?: string; subtitle?: string } }).current ?? null)
        : ((raw as { title?: string; subtitle?: string } | null) ?? null);
    return {
      code: r.code,
      host: r.host_name,
      playing: r.playing,
      updated_at: r.updated_at,
      members: counts[r.code] ?? 0,
      song_title: cur?.title ?? null,
      song_artist: cur?.subtitle ?? null,
    };
  });
  return new Response(
    JSON.stringify({ rooms: list, active: list.filter((r) => r.members > 0).length, listeners: members.length }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
