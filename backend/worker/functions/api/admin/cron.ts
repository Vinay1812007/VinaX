/**
 * Admin: Cron Health (v5.15.0).
 *   GET /api/admin/cron →
 *     { configured, jobs:[{id,label,schedule,lastAt,ageMin,ok,note}] }
 * Every scheduled job leaves a footprint (an event row or a table write);
 * this reads the newest footprint per job and flags anything overdue.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface Job { id: string; label: string; schedule: string; table: string; query: string; ts: string; maxAgeMin: number; note: string }

const JOBS: Job[] = [
  { id: 'ai-daily-push', label: 'AI daily push', schedule: '5× a day (IST 08:00 · 13:00 · 16:00 · 21:00 · 00:00)', table: 'vinax_events', query: 'type=eq.ai-push&select=created_at&order=created_at.desc&limit=1', ts: 'created_at', maxAgeMin: 9 * 60, note: 'writes an ai-push event' },
  { id: 'song-push', label: 'Song push', schedule: 'daily 19:00 IST', table: 'vinax_events', query: 'type=eq.song-push&select=created_at&order=created_at.desc&limit=1', ts: 'created_at', maxAgeMin: 26 * 60, note: 'writes a song-push event' },
  { id: 'weekly-digest', label: 'Weekly digest', schedule: 'Monday 09:00 IST', table: 'vinax_events', query: 'type=eq.weekly-digest&select=created_at&order=created_at.desc&limit=1', ts: 'created_at', maxAgeMin: 8 * 24 * 60, note: 'writes a weekly-digest event' },
  { id: 'seo-crawl', label: 'SEO crawl', schedule: 'hourly', table: 'vinax_seo_urls', query: 'select=added_at&order=added_at.desc&limit=1', ts: 'added_at', maxAgeMin: 3 * 60, note: 'grows the sitemap corpus' },
  { id: 'status-tick', label: 'Status tick', schedule: 'every 30 min', table: 'uptime_last', query: 'select=checked_at&order=checked_at.desc&limit=1', ts: 'checked_at', maxAgeMin: 75, note: 'self-probe for the status page' },
];

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, jobs: [] });
  const jobs = await Promise.all(JOBS.map(async (j) => {
    const rows = await sbSelect<Record<string, string | null>>(env, j.table, j.query).catch(() => null);
    const lastAt = rows && rows[0] ? rows[0][j.ts] ?? null : null;
    const ageMin = lastAt ? Math.round((Date.now() - Date.parse(lastAt)) / 60_000) : null;
    return { id: j.id, label: j.label, schedule: j.schedule, note: j.note, lastAt, ageMin, ok: rows === null ? null : ageMin !== null && ageMin <= j.maxAgeMin, maxAgeMin: j.maxAgeMin, readable: rows !== null };
  }));
  return json({ configured: true, checkedAt: new Date().toISOString(), jobs });
};
