/**
 * GET /api/experiments → { experiments: [{ key, variants: [{ name, pct }], audience: { platform, minVersion, percent } }] }
 *
 * The ACTIVE experiments and their splits. Assignment happens on-device
 * (deterministic hash — _lib/experiments.ts), so this endpoint learns nothing
 * about anyone. Cached five minutes; empty without a database.
 * Console rebuild — only RUNNING tests, each with who is included (the app checks
 * its platform, version and the percent itself).
 */
import { db, dbConfigured, q, type DbEnv } from '../_lib/db';
import { sanitizeAudience, sanitizeVariants } from '../_lib/experiments';

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
  let r = await db.select<{ key: string; variants: unknown; audience?: unknown; status?: string | null }>(env, 'experiments', q().eq('active', 'true').select('key,variants,audience,status').order('key').limit(50));
  // A database still on schema 7 has no audience/status columns: keep serving the splits.
  if (!r.ok) r = await db.select<{ key: string; variants: unknown }>(env, 'experiments', q().eq('active', 'true').select('key,variants').order('key').limit(50));
  if (!r.ok) return answer([]);
  return answer(
    r.rows
      .filter((e) => !e.status || e.status === 'running')
      .map((e) => ({ key: e.key, variants: sanitizeVariants(e.variants), audience: sanitizeAudience(e.audience) }))
      .filter((e) => e.variants.length),
  );
};
