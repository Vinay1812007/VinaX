/** Latest admin announcement — the Android app checks this on open/resume
 *  (the WebView has no Web Push) and shows it as a local notification. */
import { dbSelect, dbConfigured, type DbEnv } from '../_lib/db';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { env: DbEnv }): Promise<Response> => {
  const { env } = context;
  const headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=120', ...CORS };
  if (!dbConfigured(env)) return new Response(JSON.stringify({ announcement: null }), { headers });
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = await dbSelect<{ message: string | null }>(
    env,
    'vinax_events',
    `type=eq.announcement&created_at=gte.${encodeURIComponent(since)}&select=message&order=created_at.desc&limit=5`,
  ).catch(() => []);
  const announcements: unknown[] = [];
  for (const r of rows) {
    try {
      if (r.message) announcements.push(JSON.parse(r.message) as unknown);
    } catch {
      /* skip malformed */
    }
  }
  return new Response(JSON.stringify({ announcement: announcements[0] ?? null, announcements }), { headers });
};
