/** Music Analytics: top songs / artists / languages + plays-by-day. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpc, type SupabaseEnv } from '../../_lib/supabase';

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
  const [topSongs, topArtists, topLanguages, playsByDay] = await Promise.all([
    sbRpc<SongRow[]>(env, 'vinax_top_songs', { days, lim: 25 }),
    sbRpc<ArtistRow[]>(env, 'vinax_top_artists', { days, lim: 25 }),
    sbRpc<LangRow[]>(env, 'vinax_top_languages', { days, lim: 20 }),
    sbRpc<DayRow[]>(env, 'vinax_plays_by_day', { days: Math.min(days, 30) }),
  ]);

  return new Response(
    JSON.stringify({
      days,
      topSongs: topSongs ?? [],
      topArtists: topArtists ?? [],
      topLanguages: topLanguages ?? [],
      playsByDay: playsByDay ?? [],
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
