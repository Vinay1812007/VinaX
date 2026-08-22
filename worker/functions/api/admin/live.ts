/** Live Listening: devices active in the last 60s, with their current song. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface UserRow {
  device_id: string;
  name: string | null;
  city: string | null;
  country: string | null;
  platform: string | null;
  current_song_title: string | null;
  current_song_artist: string | null;
  current_song_image: string | null;
  is_playing: boolean | null;
  last_seen: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const since = new Date(Date.now() - 60_000).toISOString();
  const query =
    `last_seen=gte.${encodeURIComponent(since)}` +
    `&order=last_seen.desc&limit=500` +
    `&select=device_id,name,city,country,platform,current_song_title,current_song_artist,current_song_image,is_playing,last_seen`;
  const rows = await sbSelect<UserRow>(env, 'vinax_users', query);

  const byCountry: Record<string, number> = {};
  for (const r of rows) {
    const c = r.country ?? '??';
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }

  const listeners = rows.map((r) => ({
    name: r.name ?? 'Anonymous',
    deviceId: r.device_id,
    city: r.city,
    country: r.country,
    platform: r.platform ?? 'web',
    song: r.current_song_title,
    artist: r.current_song_artist,
    image: r.current_song_image,
    playing: !!r.is_playing,
    lastSeen: r.last_seen,
  }));

  return new Response(
    JSON.stringify({
      count: listeners.length,
      playing: listeners.filter((l) => l.playing).length,
      byCountry,
      listeners,
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
