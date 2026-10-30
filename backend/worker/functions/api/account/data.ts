/**
 * The signed-in listener's synced data (Authorization: Bearer <session>).
 *
 *   GET /api/account/data
 *     → 200 { version, updatedAt, backup }   the account's copy
 *     → 204                                   nothing stored yet
 *   PUT /api/account/data { version, backup }
 *     → 200 { version, updatedAt }            stored; `version` is the new one
 *     → 409 { version, updatedAt, backup }    another device wrote first: merge, then PUT again
 *     → 413 too_large                          more than MAX_BYTES
 *   401 signed_out without a valid session; 503 unavailable without a database.
 *
 * `backup` is the app's own backup-file JSON. `version` is
 * the copy the device last saw (0 = none); the write lands only while that is
 * still the stored version, so two devices merge instead of overwriting.
 * Lives in `account_backups`, one row per account, deleted with the account.
 */
import { bearer, readSession, type AuthEnv } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q, type DbEnv } from '../../_lib/db';

type Env = AuthEnv & DbEnv;
export const MAX_BYTES = 2_000_000;

interface Row { version: number; updated_at: string; payload?: unknown }
const copy = (row: Row) => ({ version: row.version, updatedAt: row.updated_at, backup: row.payload });

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const r = await db.one<Row>(ctx.env, 'account_backups', q().eq('account_id', sub).select('version,updated_at,payload'));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return new Response(null, { status: 204, headers: CORS });
  return json(copy(r.value));
};

export const onRequestPut = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'account-data', { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<{ version?: unknown; backup?: unknown } | null>(request, MAX_BYTES + 4_096);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const backup = read.value?.backup;
  const seen = typeof read.value?.version === 'number' && Number.isInteger(read.value.version) && read.value.version >= 0 ? read.value.version : -1;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || (backup as { format?: unknown }).format !== 'vinax-backup' || seen < 0) return json({ error: 'bad_request' }, 400);
  const bytes = JSON.stringify(backup).length;
  if (bytes > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const now = new Date().toISOString();

  if (seen === 0) {
    // First copy for this account — unless another device made one a moment ago.
    const made = await db.insert<Row>(env, 'account_backups', { account_id: sub, payload: backup, version: 1, bytes, updated_at: now }, { returning: true, onConflict: 'account_id', ignoreDuplicates: true });
    if (!made.ok) {
      // The account row is gone (deleted elsewhere): the session no longer stands.
      if (made.error === 'conflict' || made.code === '23503') return json({ error: 'signed_out' }, 401);
      return json({ error: 'unavailable' }, 503);
    }
    if (made.rows.length) return json({ version: 1, updatedAt: now });
  } else {
    const done = await db.update<Row>(env, 'account_backups', q().eq('account_id', sub).eq('version', seen).select('version,updated_at'), { payload: backup, version: seen + 1, bytes, updated_at: now }, { returning: true });
    if (!done.ok) return json({ error: 'unavailable' }, 503);
    if (done.rows.length) return json({ version: done.rows[0].version, updatedAt: done.rows[0].updated_at });
  }
  // Stale: another device wrote first. Hand back its copy to merge.
  const current = await db.one<Row>(env, 'account_backups', q().eq('account_id', sub).select('version,updated_at,payload'));
  if (!current.ok || !current.value) return json({ error: 'unavailable' }, 503);
  return json(copy(current.value), 409);
};
