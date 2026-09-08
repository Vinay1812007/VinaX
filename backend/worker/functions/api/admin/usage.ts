/**
 * Admin: Feature Usage + Listening Heatmap (v5.15.0).
 *   GET /api/admin/usage?days=7 →
 *     { configured, days, sampled, byType:[{type,n,devices}], byPlatform:[{platform,n}],
 *       heatmap: number[7][24] (IST weekday × hour play counts), peak:{day,hour,n} }
 * Reads a bounded sample of vinax_events (newest first) — no PII, only the
 * event type, platform and timestamp are used.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;
interface Row { type: string | null; platform: string | null; device_id: string | null; created_at: string }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const IST_OFFSET_MIN = 330;

export function usageFromRows(rows: Row[]): { byType: Array<{ type: string; n: number; devices: number }>; byPlatform: Array<{ platform: string; n: number }>; heatmap: number[][]; peak: { day: number; hour: number; n: number } | null } {
  const byType = new Map<string, { n: number; dev: Set<string> }>();
  const byPlatform = new Map<string, number>();
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) {
    const t = r.type || 'unknown';
    const e = byType.get(t) ?? { n: 0, dev: new Set<string>() };
    e.n += 1;
    if (r.device_id) e.dev.add(r.device_id);
    byType.set(t, e);
    const p = r.platform || 'unknown';
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    if (t === 'play' || t === 'heartbeat') {
      const d = new Date(Date.parse(r.created_at) + IST_OFFSET_MIN * 60_000);
      heatmap[d.getUTCDay()][d.getUTCHours()] += 1;
    }
  }
  let peak: { day: number; hour: number; n: number } | null = null;
  heatmap.forEach((row, day) => row.forEach((n, hour) => { if (n > 0 && (!peak || n > peak.n)) peak = { day, hour, n }; }));
  return {
    byType: [...byType.entries()].map(([type, e]) => ({ type, n: e.n, devices: e.dev.size })).sort((a, b) => b.n - a.n),
    byPlatform: [...byPlatform.entries()].map(([platform, n]) => ({ platform, n })).sort((a, b) => b.n - a.n),
    heatmap,
    peak,
  };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const days = Math.min(30, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await sbSelect<Row>(
    env,
    'vinax_events',
    `created_at=gte.${encodeURIComponent(since)}&select=type,platform,device_id,created_at&order=created_at.desc&limit=10000`,
  ).catch(() => [] as Row[]);
  return json({ configured: true, days, sampled: rows.length, ...usageFromRows(rows) });
};
