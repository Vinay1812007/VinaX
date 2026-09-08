/**
 * Admin: Onboarding Funnel (v5.15.0).
 *   GET /api/admin/funnel?days=7 →
 *     { configured, days, steps:[{id,label,devices,pct}], sampled }
 * Distinct devices that reached each step inside the window: opened the app
 * → registered a name → played a song → finished a song → liked one →
 * searched → shared. Percentages are against the first step.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;
interface Row { type: string | null; device_id: string | null }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const STEPS: Array<{ id: string; label: string; types: string[] }> = [
  { id: 'open', label: 'Opened the app', types: ['open', 'play', 'heartbeat', 'search', 'register'] },
  { id: 'register', label: 'Chose a name', types: ['register'] },
  { id: 'play', label: 'Played a song', types: ['play', 'heartbeat', 'complete'] },
  { id: 'complete', label: 'Finished a song', types: ['complete'] },
  { id: 'favorite', label: 'Liked a song', types: ['favorite'] },
  { id: 'search', label: 'Searched', types: ['search'] },
  { id: 'share', label: 'Shared', types: ['share'] },
];

export function funnel(rows: Row[]): Array<{ id: string; label: string; devices: number; pct: number }> {
  const sets = STEPS.map(() => new Set<string>());
  for (const r of rows) {
    if (!r.device_id || !r.type) continue;
    STEPS.forEach((s, i) => { if (s.types.includes(r.type as string)) sets[i].add(r.device_id as string); });
  }
  const base = sets[0].size || 1;
  return STEPS.map((s, i) => ({ id: s.id, label: s.label, devices: sets[i].size, pct: Math.round((sets[i].size / base) * 100) }));
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, steps: [] });
  const days = Math.min(30, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await sbSelect<Row>(
    env,
    'vinax_events',
    `created_at=gte.${encodeURIComponent(since)}&type=in.(open,register,play,heartbeat,complete,favorite,search,share)&select=type,device_id&order=created_at.desc&limit=10000`,
  ).catch(() => [] as Row[]);
  return json({ configured: true, days, sampled: rows.length, steps: funnel(rows) });
};
