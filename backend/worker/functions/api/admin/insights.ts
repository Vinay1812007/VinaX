/** Insights: user segments, hourly activity, trending songs, top listeners, languages. */
import { adminJson, dbFailure, isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpcResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

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
  if (!supabaseConfigured(env)) return adminJson({ configured: false, days, segments: null, playsByHour: [], trending: [], topListeners: [], languages: [] });
  const [segments, playsByHour, trending, topListeners, languages] = await Promise.all([
    sbRpcResult<Segments>(env, 'vinax_segments', {}),
    sbRpcResult<HourRow[]>(env, 'vinax_plays_by_hour', { days }),
    sbRpcResult<TrendRow[]>(env, 'vinax_trending', { days, lim: 15 }),
    sbRpcResult<ListenerRow[]>(env, 'vinax_top_listeners', { days, lim: 20 }),
    sbRpcResult<LangRow[]>(env, 'vinax_languages', { days }),
  ]);
  // 7.2.0 — segment cards and charts from failed reads would read as zeros.
  if (!segments.ok) return dbFailure(segments);
  if (!playsByHour.ok) return dbFailure(playsByHour);
  if (!trending.ok) return dbFailure(trending);
  if (!topListeners.ok) return dbFailure(topListeners);
  if (!languages.ok) return dbFailure(languages);

  return adminJson({
    configured: true,
    days,
    segments: segments.value ?? null,
    playsByHour: playsByHour.value ?? [],
    trending: trending.value ?? [],
    topListeners: topListeners.value ?? [],
    languages: languages.value ?? [],
  });
};
