/** Overview: headline KPIs, engagement (DAU/WAU/MAU), and growth charts. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbRpc, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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

  const [summary, newUsersByDay, playsByDay, topSongs, geo] = await Promise.all([
    dbRpc<Summary>(env, 'vinax_overview', {}),
    dbRpc<DayUsers[]>(env, 'vinax_new_users_by_day', { days: 14 }),
    dbRpc<DayPlays[]>(env, 'vinax_plays_by_day', { days: 14 }),
    dbRpc<SongRow[]>(env, 'vinax_top_songs', { days: 7, lim: 5 }),
    dbRpc<GeoRow[]>(env, 'vinax_geo', { days: 7 }),
  ]);

  const byCountry: Record<string, number> = {};
  for (const r of geo ?? []) byCountry[r.country] = (byCountry[r.country] ?? 0) + r.listeners;
  const topCountries = Object.entries(byCountry)
    .map(([country, listeners]) => ({ country, listeners }))
    .sort((a, b) => b.listeners - a.listeners)
    .slice(0, 8);

  return new Response(
    JSON.stringify({
      summary: summary ?? null,
      newUsersByDay: newUsersByDay ?? [],
      playsByDay: playsByDay ?? [],
      topSongs: topSongs ?? [],
      topCountries,
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
