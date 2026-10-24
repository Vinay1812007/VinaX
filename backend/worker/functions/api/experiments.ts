/**
 * GET /api/experiments → { experiments: [{ key, variants: [{ name, pct }] }] }
 *
 * The ACTIVE experiments and their splits. Assignment happens on-device
 * (deterministic hash — _lib/experiments.ts), so this endpoint learns nothing
 * about anyone. Cached five minutes; empty without a database.
 */
import { db, dbConfigured, q, type DbEnv } from '../_lib/db';
import { sanitizeVariants } from '../_lib/experiments';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const answer = (experiments: unknown[]): Response =>
  new Response(JSON.stringify({ experiments }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS },
  });

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx?: { env?: DbEnv }): Promise<Response> => {
  const env = ctx?.env ?? {};
  if (!dbConfigured(env)) return answer([]);
  const r = await db.select<{ key: string; variants: unknown }>(env, 'experiments', q().eq('active', 'true').select('key,variants').order('key').limit(50));
  if (!r.ok) return answer([]);
  return answer(r.rows.map((e) => ({ key: e.key, variants: sanitizeVariants(e.variants) })).filter((e) => e.variants.length));
};
