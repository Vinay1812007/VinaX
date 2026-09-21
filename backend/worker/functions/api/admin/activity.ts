/** Activity Feed: the most recent raw events across all listeners. */
import { adminJson, dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface EventRow {
  type: string;
  song_title: string | null;
  song_artist: string | null;
  device_id: string | null;
  platform: string | null;
  country: string | null;
  city: string | null;
  created_at: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();

  if (!supabaseConfigured(env)) return adminJson({ configured: false, events: [] });
  const read = await sbSelectResult<EventRow>(
    env,
    'vinax_events',
    // device 'admin' rows are system markers (site-mode, digests, announcements) — not listener activity
    'select=type,song_title,song_artist,device_id,platform,country,city,created_at&device_id=neq.admin&order=created_at.desc&limit=80',
  );

  // 7.2.0 — a failed read is not a quiet feed.
  if (!read.ok) return dbFailure(read);
  return adminJson({ configured: true, events: read.rows });
};
