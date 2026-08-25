/** Insights: user segments, hourly activity, trending songs, top listeners, languages. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpc, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

function clampDays(v: string | null): number {
  const n = parseInt(v ?? '7', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 7;
}

interface Segments { new_7d: number; returning_7d: number; inactive_30d: number; power_users: number; }
interface HourRow { hour: number; plays: number; }
interface TrendRow { song_title: string; song_artist: string | null; song_image: string | null; plays: number; prev_plays: number; }
interface ListenerRow { device_id: string; name: string | null; username?: string | null; plays: number; }
interface LangRow { language: string; plays: number; listeners: number; }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const [segments, playsByHour, trending, topListeners, languages] = await Promise.all([
    sbRpc<Segments>(env, 'vinax_segments', {}),
    sbRpc<HourRow[]>(env, 'vinax_plays_by_hour', { days }),
    sbRpc<TrendRow[]>(env, 'vinax_trending', { days, lim: 15 }),
    sbRpc<ListenerRow[]>(env, 'vinax_top_listeners', { days, lim: 20 }),
    sbRpc<LangRow[]>(env, 'vinax_languages', { days }),
  ]);

  return new Response(
    JSON.stringify({
      days,
      segments: segments ?? null,
      playsByHour: playsByHour ?? [],
      trending: trending ?? [],
      topListeners: topListeners ?? [],
      languages: languages ?? [],
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
