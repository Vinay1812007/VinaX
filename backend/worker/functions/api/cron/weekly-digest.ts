/** Weekly owner digest — run Monday morning by GitHub Actions.
 *  Aggregates the last 7 days into one row the admin Overview displays.
 *  Counts are computed from a capped sample (newest 5000 events), so on busy
 *  weeks they are floors, not exact totals — the digest says so. */
import { dbInsert, dbSelect, dbConfigured, type DbEnv } from '../../_lib/db';
import { safeEqual } from '../../_lib/safe-compare';

type Env = DbEnv & { CRON_SECRET?: string };

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Audit finding H-SRV-7: `?key=` in the URL leaked into Cloudflare's
  // request logs. Header-only from here on.
  // NOTE: workflows must send x-cron-secret header, not ?key= query param.
  const key = request.headers.get('x-cron-secret') ?? '';
  // Constant-time compare so response timing can't leak the cron secret
  // byte-by-byte (audit finding M11).
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!dbConfigured(env)) return json({ error: 'db_not_configured' }, 400);

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const enc = encodeURIComponent(since);

  const [activeUsers, newUsers, events] = await Promise.all([
    dbSelect<{ device_id: string }>(env, 'vinax_users', `last_seen=gte.${enc}&select=device_id&limit=5000`).catch(() => []),
    dbSelect<{ device_id: string }>(env, 'vinax_users', `first_seen=gte.${enc}&select=device_id&limit=5000`).catch(() => []),
    dbSelect<{ type: string; song_title: string | null; message: string | null }>(
      env,
      'vinax_events',
      `created_at=gte.${enc}&select=type,song_title,message&order=created_at.desc&limit=5000`,
    ).catch(() => []),
  ]);

  let plays = 0;
  let searches = 0;
  let errors = 0;
  const songCounts = new Map<string, number>();
  const searchCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'play') {
      plays += 1;
      if (e.song_title) songCounts.set(e.song_title, (songCounts.get(e.song_title) ?? 0) + 1);
    } else if (e.type === 'search') {
      searches += 1;
      const raw = e.message ?? '';
      const i = raw.indexOf('|');
      const q = i >= 0 ? raw.slice(i + 1).trim() : '';
      if (q && Number(raw.slice(0, i)) !== 0) searchCounts.set(q, (searchCounts.get(q) ?? 0) + 1);
    } else if (e.type === 'error') {
      errors += 1;
    }
  }
  const top = (m: Map<string, number>): string => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const digest = {
    week_of: since.slice(0, 10),
    active_listeners: activeUsers.length,
    new_listeners: newUsers.length,
    plays,
    searches,
    errors,
    top_song: top(songCounts).slice(0, 80),
    top_search: top(searchCounts).slice(0, 60),
    sampled: events.length >= 5000,
    ts: Date.now(),
  };
  const ok = await dbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'weekly-digest',
    message: JSON.stringify(digest).slice(0, 900),
  });
  return json({ ok, digest });
};
