/** Live Listening: devices active in the last 60s, with their current song. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface UserRow {
  device_id: string;
  name: string | null;
  username?: string | null;
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
  if (!(await isAdminAsync(request, env))) return unauthorized();

  if (!supabaseConfigured(env)) return adminJson({ configured: false, count: 0, playing: 0, byCountry: {}, listeners: [] });
  const since = new Date(Date.now() - 60_000).toISOString();
  const query =
    `last_seen=gte.${encodeURIComponent(since)}` +
    `&order=last_seen.desc&limit=500` +
    `&select=device_id,name,username,city,country,platform,current_song_title,current_song_artist,current_song_image,is_playing,last_seen`;
  const read = await sbSelectResult<UserRow>(env, 'vinax_users', query);
  // 7.2.0 — a failed read is not "nobody listening".
  if (!read.ok) return dbFailure(read);
  const rows = read.rows;

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

  return adminJson({
    configured: true,
    count: listeners.length,
    playing: listeners.filter((l) => l.playing).length,
    byCountry,
    listeners,
  });
};
