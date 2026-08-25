/** Activity Feed: the most recent raw events across all listeners. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { dbSelect, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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
  if (!isAdmin(request, env)) return unauthorized();

  const events = await dbSelect<EventRow>(
    env,
    'vinax_events',
    // device 'admin' rows are system markers (site-mode, digests, announcements) — not listener activity
    'select=type,song_title,song_artist,device_id,platform,country,city,created_at&device_id=neq.admin&order=created_at.desc&limit=80',
  );

  return new Response(JSON.stringify({ events }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
