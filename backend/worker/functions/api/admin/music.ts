/** Music Analytics: top songs / artists / languages + plays-by-day. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

interface SongRow { song_title: string; song_artist: string | null; song_image: string | null; plays: number; }
interface ArtistRow { song_artist: string; plays: number; }
interface LangRow { language: string; plays: number; }
interface DayRow { day: string; plays: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const days = clampDays(new URL(request.url).searchParams.get('days'));
  if (!supabaseConfigured(env)) return adminJson({ configured: false, days, topSongs: [], topArtists: [], topLanguages: [], playsByDay: [] });
  const [topSongs, topArtists, topLanguages, playsByDay] = await Promise.all([
    sbRpcResult<SongRow[]>(env, 'vinax_top_songs', { days, lim: 25 }),
    sbRpcResult<ArtistRow[]>(env, 'vinax_top_artists', { days, lim: 25 }),
    sbRpcResult<LangRow[]>(env, 'vinax_top_languages', { days, lim: 20 }),
    sbRpcResult<DayRow[]>(env, 'vinax_plays_by_day', { days: Math.min(days, 30) }),
  ]);
  // 7.2.0 — empty charts from failed reads look like "nothing was played".
  if (!topSongs.ok) return dbFailure(topSongs);
  if (!topArtists.ok) return dbFailure(topArtists);
  if (!topLanguages.ok) return dbFailure(topLanguages);
  if (!playsByDay.ok) return dbFailure(playsByDay);

  return adminJson({
    configured: true,
    days,
    topSongs: topSongs.value ?? [],
    topArtists: topArtists.value ?? [],
    topLanguages: topLanguages.value ?? [],
    playsByDay: playsByDay.value ?? [],
  });
};
