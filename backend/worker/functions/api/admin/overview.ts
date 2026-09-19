/** Overview: headline KPIs, engagement (DAU/WAU/MAU), and growth charts. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface Summary {
  active_now: number; total_users: number; new_today: number; plays_today: number;
  plays_7d: number; errors_24h: number; dau: number; wau: number; mau: number; feedback_new: number;
}
interface DayUsers { day: string; users: number; }
interface DayPlays { day: string; plays: number; }
interface SongRow { song_title: string; song_artist: string | null; song_image: string | null; plays: number; }
interface GeoRow { country: string; city: string; listeners: number; plays: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, summary: null, newUsersByDay: [], playsByDay: [], topSongs: [], topCountries: [] });

  const [summary, newUsersByDay, playsByDay, topSongs, geo] = await Promise.all([
    sbRpcResult<Summary>(env, 'vinax_overview', {}),
    sbRpcResult<DayUsers[]>(env, 'vinax_new_users_by_day', { days: 14 }),
    sbRpcResult<DayPlays[]>(env, 'vinax_plays_by_day', { days: 14 }),
    sbRpcResult<SongRow[]>(env, 'vinax_top_songs', { days: 7, lim: 5 }),
    sbRpcResult<GeoRow[]>(env, 'vinax_geo', { days: 7 }),
  ]);
  // 7.2.0 — every part is a headline number or chart: one failed read makes
  // the whole panel unavailable rather than a mix of real data and zeros.
  if (!summary.ok) return dbFailure(summary);
  if (!newUsersByDay.ok) return dbFailure(newUsersByDay);
  if (!playsByDay.ok) return dbFailure(playsByDay);
  if (!topSongs.ok) return dbFailure(topSongs);
  if (!geo.ok) return dbFailure(geo);

  const byCountry: Record<string, number> = {};
  for (const r of geo.value ?? []) byCountry[r.country] = (byCountry[r.country] ?? 0) + r.listeners;
  const topCountries = Object.entries(byCountry)
    .map(([country, listeners]) => ({ country, listeners }))
    .sort((a, b) => b.listeners - a.listeners)
    .slice(0, 8);

  return adminJson({
    configured: true,
    summary: summary.value ?? null,
    newUsersByDay: newUsersByDay.value ?? [],
    playsByDay: playsByDay.value ?? [],
    topSongs: topSongs.value ?? [],
    topCountries,
  });
};
