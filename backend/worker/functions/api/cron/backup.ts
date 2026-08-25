/**
 * POST /api/cron/backup — nightly D1 → R2 snapshot.
 *
 * Dumps every vinax_* table as JSON into the BACKUPS R2 bucket under
 * backup/<YYYY-MM-DD>/<table>.json, then prunes snapshots older than
 * KEEP_DAYS. Complements D1's built-in Time Travel with an off-database
 * copy the owner can download from the Cloudflare dashboard any time.
 *
 * Auth: x-cron-secret header (same contract as every other /api/cron/*).
 * Fired daily by .github/workflows/backup.yml.
 */
import { dbConfigured, dbSelect, type DbEnv } from '../../_lib/db';
import { safeEqual } from '../../_lib/safe-compare';

// Minimal structural types for the R2 binding (no SDK dep).
interface R2Bucket {
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated?: boolean;
    cursor?: string;
  }>;
}

type Env = DbEnv & { CRON_SECRET?: string; BACKUPS?: R2Bucket };

const TABLES = [
  'vinax_users',
  'vinax_events',
  'vinax_feedback',
  'vinax_blocklist',
  'vinax_ai_events',
  'vinax_rooms',
  'vinax_room_members',
  'vinax_push_subscriptions',
  'vinax_fcm_tokens',
  'vinax_seo_urls',
  'vinax_config',
  'vinax_experiments',
];

const ROW_CAP = 50_000; // per table per snapshot — far above current volumes
const KEEP_DAYS = 14;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const key = request.headers.get('x-cron-secret') ?? '';
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!dbConfigured(env)) return json({ error: 'db_not_configured' }, 400);
  if (!env.BACKUPS) return json({ error: 'r2_not_configured' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const written: Record<string, number> = {};
  for (const table of TABLES) {
    const rowsData = await dbSelect<Record<string, unknown>>(env, table, `select=*&limit=${ROW_CAP}`);
    await env.BACKUPS.put(`backup/${day}/${table}.json`, JSON.stringify(rowsData));
    written[table] = rowsData.length;
  }

  // Prune snapshots older than KEEP_DAYS (keys are date-named, so a string
  // compare on the YYYY-MM-DD segment is a correct age test).
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  let pruned = 0;
  let cursor: string | undefined;
  try {
    do {
      const page = await env.BACKUPS.list({ prefix: 'backup/', cursor });
      for (const obj of page.objects) {
        const objDay = obj.key.split('/')[1] ?? '';
        if (objDay && objDay < cutoff) {
          await env.BACKUPS.delete(obj.key);
          pruned += 1;
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch {
    /* pruning is best-effort; the snapshot itself already succeeded */
  }

  return json({ ok: true, day, tables: written, pruned });
};
