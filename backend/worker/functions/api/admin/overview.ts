/** Overview: headline KPIs, engagement (DAU/WAU/MAU), and growth charts. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbCountResult, sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { readPlatforms } from '../../_lib/platforms';

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
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return adminJson({ configured: false, summary: null, newUsersByDay: [], playsByDay: [], topSongs: [], topCountries: [], accounts: null, platforms: null });

  // 13.8 — signed-in accounts live in vinax_accounts (Google sign-in), not
  // in vinax_users (opt-in listening telemetry), so count them separately.
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  // 13.9 — plus the platform split (accounts AND devices), so Android and
  // web listeners show on the first screen even when nobody shares usage.
  const [summary, newUsersByDay, playsByDay, topSongs, geo, accounts, accountsToday, accounts7d, platforms] = await Promise.all([
    sbRpcResult<Summary>(env, 'vinax_overview', {}),
    sbRpcResult<DayUsers[]>(env, 'vinax_new_users_by_day', { days: 14 }),
    sbRpcResult<DayPlays[]>(env, 'vinax_plays_by_day', { days: 14 }),
    sbRpcResult<SongRow[]>(env, 'vinax_top_songs', { days: 7, lim: 5 }),
    sbRpcResult<GeoRow[]>(env, 'vinax_geo', { days: 7 }),
    sbCountResult(env, 'vinax_accounts'),
    sbCountResult(env, 'vinax_accounts', `created_at=gte.${encodeURIComponent(dayStart.toISOString())}`),
    sbCountResult(env, 'vinax_accounts', `last_seen=gte.${encodeURIComponent(since7)}`),
    readPlatforms(env),
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
    // null when the accounts table is unreachable — the KPI shows "—".
    accounts: {
      total: accounts.ok ? accounts.value : null,
      newToday: accountsToday.ok ? accountsToday.value : null,
      active7d: accounts7d.ok ? accounts7d.value : null,
    },
    platforms,
  });
};
