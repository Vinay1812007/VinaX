/**
 * Admin: Skip Report (v5.15.0).
 *   GET /api/admin/skips?days=7&min=5 →
 *     { configured, days, min, sampled, source, items:[{id,title,artist,image,plays,skips,rate}] }
 * Songs listeners bail on most, ranked by skip rate among songs with at
 * least `min` plays — the shortlist for the Content Control panel.
 * v5.16.0: exact ranking through the vinax_skips RPC (`source: 'exact'`);
 * the newest-10k sample remains the fallback until the migration is applied
 * (`source: 'sampled'`).
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbRpc, sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;
interface Row { type: string | null; song_id: string | null; song_title: string | null; song_artist: string | null; song_image: string | null }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export interface SkipItem { id: string; title: string; artist: string; image: string; plays: number; skips: number; rate: number }

export function skipTable(rows: Row[], min: number): SkipItem[] {
  const m = new Map<string, { id: string; title: string; artist: string; image: string; plays: number; skips: number }>();
  for (const r of rows) {
    if (!r.song_id || (r.type !== 'play' && r.type !== 'skip')) continue;
    const e = m.get(r.song_id) ?? { id: r.song_id, title: r.song_title ?? '', artist: r.song_artist ?? '', image: r.song_image ?? '', plays: 0, skips: 0 };
    if (r.type === 'play') e.plays += 1; else e.skips += 1;
    m.set(r.song_id, e);
  }
  return [...m.values()]
    .filter((e) => e.plays >= min && e.skips > 0)
    .map((e) => ({ ...e, rate: Math.round((e.skips / e.plays) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.skips - a.skips)
    .slice(0, 50);
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, items: [] });
  const url = new URL(request.url);
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get('days') ?? '7', 10) || 7));
  const min = Math.min(100, Math.max(1, parseInt(url.searchParams.get('min') ?? '5', 10) || 5));
  const exact = await sbRpc<SkipItem[]>(env, 'vinax_skips', { p_days: days, p_min: min });
  if (Array.isArray(exact)) {
    // sampled = plays+skips the ranking is built on — same meaning as below.
    const sampled = exact.reduce((n, e) => n + (e.plays || 0) + (e.skips || 0), 0);
    return json({ configured: true, days, min, sampled, source: 'exact', items: exact });
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await sbSelect<Row>(
    env,
    'vinax_events',
    `type=in.(play,skip)&created_at=gte.${encodeURIComponent(since)}&select=type,song_id,song_title,song_artist,song_image&order=created_at.desc&limit=10000`,
  ).catch(() => [] as Row[]);
  return json({ configured: true, days, min, sampled: rows.length, source: 'sampled', items: skipTable(rows, min) });
};
