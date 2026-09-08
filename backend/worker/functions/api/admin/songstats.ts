/**
 * Admin: Song Drilldown (v5.15.0).
 *   GET /api/admin/songstats?q=<song id or title fragment>&days=30 →
 *     { configured, match:{id,title,artist,image}|null, candidates:[...],
 *       totals:{plays,skips,completes,favorites,listeners}, byDay:[{day,plays,skips}],
 *       countries:[{country,n}], platforms:[{platform,n}], skipRate }
 * Song ids match exactly; a title fragment picks the most-played match and
 * lists the other candidates so the operator can switch.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;
interface Row { type: string | null; song_id: string | null; song_title: string | null; song_artist: string | null; song_image: string | null; device_id: string | null; country: string | null; platform: string | null; created_at: string }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const COUNTED = new Set(['play', 'skip', 'complete', 'favorite']);

export function summarise(rows: Row[]): {
  totals: { plays: number; skips: number; completes: number; favorites: number; listeners: number };
  byDay: Array<{ day: string; plays: number; skips: number }>;
  countries: Array<{ country: string; n: number }>;
  platforms: Array<{ platform: string; n: number }>;
  skipRate: number | null;
} {
  const totals = { plays: 0, skips: 0, completes: 0, favorites: 0, listeners: 0 };
  const dev = new Set<string>();
  const byDay = new Map<string, { plays: number; skips: number }>();
  const countries = new Map<string, number>();
  const platforms = new Map<string, number>();
  for (const r of rows) {
    if (!r.type || !COUNTED.has(r.type)) continue;
    if (r.type === 'play') totals.plays += 1;
    if (r.type === 'skip') totals.skips += 1;
    if (r.type === 'complete') totals.completes += 1;
    if (r.type === 'favorite') totals.favorites += 1;
    if (r.device_id) dev.add(r.device_id);
    const day = r.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { plays: 0, skips: 0 };
    if (r.type === 'play') d.plays += 1;
    if (r.type === 'skip') d.skips += 1;
    byDay.set(day, d);
    if (r.type === 'play') {
      if (r.country) countries.set(r.country, (countries.get(r.country) ?? 0) + 1);
      if (r.platform) platforms.set(r.platform, (platforms.get(r.platform) ?? 0) + 1);
    }
  }
  totals.listeners = dev.size;
  return {
    totals,
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    countries: [...countries.entries()].map(([country, n]) => ({ country, n })).sort((a, b) => b.n - a.n).slice(0, 10),
    platforms: [...platforms.entries()].map(([platform, n]) => ({ platform, n })).sort((a, b) => b.n - a.n),
    skipRate: totals.plays ? Math.round((totals.skips / totals.plays) * 100) : null,
  };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') ?? '30', 10) || 30));
  if (!q) return json({ error: 'bad_request' }, 400);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const looksLikeId = /^[A-Za-z0-9_-]{4,40}$/.test(q) && !/\s/.test(q) && !/^[a-z]+$/i.test(q);
  const filter = looksLikeId ? `song_id=eq.${encodeURIComponent(q)}` : `song_title=ilike.${encodeURIComponent('*' + q.replace(/[%*,()]/g, ' ').trim() + '*')}`;
  const rows = await sbSelect<Row>(
    env,
    'vinax_events',
    `${filter}&created_at=gte.${encodeURIComponent(since)}&select=type,song_id,song_title,song_artist,song_image,device_id,country,platform,created_at&order=created_at.desc&limit=8000`,
  ).catch(() => [] as Row[]);
  // Pick the dominant song among title matches; keep the rest as candidates.
  const bySong = new Map<string, { id: string; title: string; artist: string; image: string; n: number }>();
  for (const r of rows) {
    if (!r.song_id) continue;
    const e = bySong.get(r.song_id) ?? { id: r.song_id, title: r.song_title ?? '', artist: r.song_artist ?? '', image: r.song_image ?? '', n: 0 };
    e.n += 1;
    bySong.set(r.song_id, e);
  }
  const ranked = [...bySong.values()].sort((a, b) => b.n - a.n);
  const match = ranked[0] ?? null;
  const own = match ? rows.filter((r) => r.song_id === match.id) : [];
  return json({ configured: true, days, q, match, candidates: ranked.slice(1, 8), ...summarise(own) });
};
