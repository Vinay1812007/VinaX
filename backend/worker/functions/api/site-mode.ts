/** Current site mode — 'live' (default) or 'maintenance' with a note.
 *  Set from the admin console; the client checks this every minute. */
import { sbSelect, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';
import { maintenanceActive, readConfig } from '../_lib/clientConfig';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { env: SupabaseEnv }): Promise<Response> => {
  const { env } = context;
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...CORS };
  if (!supabaseConfigured(env)) return new Response(JSON.stringify({ mode: 'live' }), { headers });
  const rows = await sbSelect<{ message: string | null }>(
    env,
    'vinax_events',
    // device_id=eq.admin: only the admin console's own rows are honoured, so a
    // forged telemetry row could never flip the site even if one got in.
    'type=eq.site-mode&device_id=eq.admin&select=message&order=created_at.desc&limit=1',
  ).catch(() => []);
  // v5.15.0 — a scheduled window (Admin → Maintenance Scheduler) flips the
  // site to maintenance on its own and back again, no one awake required.
  const win = maintenanceActive((await readConfig(env, ['maintenance-window']))['maintenance-window']);
  if (win) return new Response(JSON.stringify({ mode: 'maintenance', note: win.note, scheduled: true }), { headers });
  const raw = rows[0]?.message ?? 'live|';
  const i = raw.indexOf('|');
  const mode = (i >= 0 ? raw.slice(0, i) : raw) === 'maintenance' ? 'maintenance' : 'live';
  const note = i >= 0 ? raw.slice(i + 1).slice(0, 200) : '';
  return new Response(JSON.stringify({ mode, note }), { headers });
};
