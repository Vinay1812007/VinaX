/**
 * 13.0 — the signed-in listener's synced data (Authorization: Bearer <session>).
 *
 *   GET /api/account/data
 *     → 200 { version, updatedAt, backup }   the account's copy
 *     → 204                                   nothing stored yet
 *   PUT /api/account/data { version, backup }
 *     → 200 { version, updatedAt }            stored; `version` is the new one
 *     → 409 { version, updatedAt, backup }    another device wrote first: merge
 *                                             this copy, then PUT again
 *     → 413 too_large  (more than MAX_BYTES)
 *   401 signed_out without a valid session; 503 when the database is not set up.
 *
 * `backup` is the app's own backup-file JSON (features/settings/backup.ts),
 * never AI chats. `version` is the copy the device last saw (0 = none); the
 * write only lands when that is still the stored version, so two devices
 * merge instead of overwriting each other.
 */
import { bearer, readSession, type AuthEnv } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { sbInsertIgnore, sbSelectRes, sbUpdateReturning, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AuthEnv & SupabaseEnv;
export const MAX_BYTES = 2_000_000;

interface Row { version: number; updated_at: string; backup?: unknown }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, OPTIONS' } });

async function current(env: Env, sub: string, withBackup: boolean): Promise<Row | null | undefined> {
  const r = await sbSelectRes<Row>(env, 'vinax_account_data', `google_sub=eq.${encodeURIComponent(sub)}&select=version,updated_at${withBackup ? ',backup' : ''}&limit=1`);
  if (!r.ok) return undefined;
  return r.rows[0] ?? null;
}

const copy = (row: Row) => ({ version: row.version, updatedAt: row.updated_at, backup: row.backup });

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!supabaseConfigured(env)) return json({ error: 'unavailable' }, 503);
  const row = await current(env, sub, true);
  if (row === undefined) return json({ error: 'unavailable' }, 503);
  if (!row) return new Response(null, { status: 204, headers: CORS });
  return json(copy(row));
};

export const onRequestPut = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'account-data', { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!supabaseConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<{ version?: unknown; backup?: unknown } | null>(request, MAX_BYTES + 4_096);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = read.value;
  const backup = body?.backup;
  const seen = typeof body?.version === 'number' && Number.isInteger(body.version) && body.version >= 0 ? body.version : -1;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || (backup as { format?: unknown }).format !== 'vinax-backup' || seen < 0) return json({ error: 'bad_request' }, 400);
  const bytes = JSON.stringify(backup).length;
  if (bytes > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const now = new Date().toISOString();

  if (seen === 0) {
    // First copy for this account; someone else may have created it a moment ago.
    const made = await sbInsertIgnore<Row>(env, 'vinax_account_data', { google_sub: sub, backup, version: 1, bytes, updated_at: now }, 'google_sub');
    if (made === null) return json({ error: 'unavailable' }, 503);
    if (made.length) return json({ version: 1, updatedAt: now });
  } else {
    const done = await sbUpdateReturning<Row>(
      env,
      'vinax_account_data',
      `google_sub=eq.${encodeURIComponent(sub)}&version=eq.${seen}`,
      { backup, version: seen + 1, bytes, updated_at: now },
      'version,updated_at',
    );
    if (done === null) return json({ error: 'unavailable' }, 503);
    if (done.length) return json({ version: done[0].version, updatedAt: done[0].updated_at });
  }
  // Stale: another device wrote first. Hand back its copy to merge.
  const row = await current(env, sub, true);
  if (!row) return json({ error: 'unavailable' }, 503);
  return json(copy(row), 409);
};
