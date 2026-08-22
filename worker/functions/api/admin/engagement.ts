/** Engagement: skip/completion/repeat rates, favorites/downloads/shares,
 *  retention cohorts (D1/D7/D30, approximate), avg plays per user. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days') || 7)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [events, users] = await Promise.all([
    sbSelect<{ type: string; device_id: string | null; song_id: string | null }>(
      env, 'vinax_events',
      `type=in.(play,skip,complete,favorite,download,share)&created_at=gte.${encodeURIComponent(since)}&select=type,device_id,song_id&order=created_at.desc&limit=5000`,
    ),
    sbSelect<{ first_seen: string; last_seen: string }>(
      env, 'vinax_users', 'select=first_seen,last_seen&limit=5000',
    ),
  ]);
  const c: Record<string, number> = { play: 0, skip: 0, complete: 0, favorite: 0, download: 0, share: 0 };
  const perPair = new Map<string, number>();
  const perUser = new Map<string, number>();
  for (const e of events) {
    c[e.type] = (c[e.type] ?? 0) + 1;
    if (e.type === 'play') {
      if (e.device_id && e.song_id) {
        const k = `${e.device_id}|${e.song_id}`;
        perPair.set(k, (perPair.get(k) ?? 0) + 1);
      }
      if (e.device_id) perUser.set(e.device_id, (perUser.get(e.device_id) ?? 0) + 1);
    }
  }
  const repeats = [...perPair.values()].filter((n) => n > 1).length;
  const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
  // Approximate retention: cohort first seen N..2N days ago, retained if
  // last_seen within the last N days.
  const ret = (n: number) => {
    const lo = Date.now() - 2 * n * 86_400_000;
    const hi = Date.now() - n * 86_400_000;
    const cohort = users.filter((u) => {
      const f = new Date(u.first_seen).getTime();
      return f >= lo && f < hi;
    });
    if (!cohort.length) return null;
    const kept = cohort.filter((u) => new Date(u.last_seen).getTime() >= hi).length;
    return Math.round((kept / cohort.length) * 100);
  };
  return new Response(
    JSON.stringify({
      days,
      plays: c.play, skips: c.skip, completes: c.complete,
      favorites: c.favorite, downloads: c.download, shares: c.share,
      skipRate: rate(c.skip, c.play + c.skip),
      completionRate: rate(c.complete, c.play),
      repeatRate: rate(repeats, perPair.size),
      avgPlaysPerUser: perUser.size ? Math.round((c.play / perUser.size) * 10) / 10 : 0,
      retention: { d1: ret(1), d7: ret(7), d30: ret(30) },
      totalUsers: users.length,
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
