/**
 * GET /api/auth/me   (Authorization: Bearer <session>, x-vinax-device?)
 *   → 200 { user }               the account as the database has it
 *   → 200 { ok: true }           no database on this Worker: the session alone stands
 *   → 401 { error: 'signed_out' } bad session, or the account row is gone (deleted)
 *   → 503 { error: 'unavailable' } the database did not answer
 * POST /api/auth/me { delete: true } → 200 { ok: true } — removes the account
 *   row and, with it, the synced backup. Usage events are anonymous and stay.
 *
 * The session check keeps the account current: last_seen is refreshed at
 * most every TOUCH_MS, and a proved device id (the header) links the device,
 * so a listener who ticked "share usage" after signing in is still one row
 * in the console. Best effort, after the answer.
 */
import { bearer, readSession, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q, type DbEnv } from '../../_lib/db';
import { DEVICE_HEADER, verifiedIdentity, type IdentityEnv } from '../../_lib/identity';
import { accountFacts, accountOf, CORS, handleOf, json, publicUser, type AccountRow } from '../../_lib/authShared';

type Env = AuthEnv & DbEnv & IdentityEnv;

/** How stale last_seen may get before a session check refreshes it. */
export const TOUCH_MS = 10 * 60_000;

export async function touchAccount(request: Request, env: Env, row: AccountRow): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  const proved = await verifiedIdentity(env, request.headers.get(DEVICE_HEADER));
  if (proved && proved !== row.listener_id) patch.listener_id = proved;
  const last = Date.parse(row.last_seen ?? '');
  if (patch.listener_id || !Number.isFinite(last) || Date.now() - last > TOUCH_MS) {
    patch.last_seen = new Date().toISOString();
    Object.assign(patch, accountFacts(request));
  }
  if (!Object.keys(patch).length) return false;
  const r = await db.update(env, 'accounts', q().eq('id', row.id), patch);
  return r.ok;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ ok: true });
  const r = await accountOf(env, sub);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return json({ error: 'signed_out' }, 401);
  const row = r.value;
  const touch = touchAccount(request, env, row).catch(() => false);
  if (ctx.waitUntil) ctx.waitUntil(touch);
  else await touch;
  return json({ user: publicUser(row, await handleOf(env, row.listener_id)) });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-me', { capacity: 5, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const read = await readJsonCapped<{ delete?: unknown } | null>(request, 1_000);
  if (!read.ok || read.value?.delete !== true) return json({ error: 'bad_request' }, 400);
  if (!dbConfigured(env)) return json({ ok: true });
  const r = await db.remove(env, 'accounts', q().eq('id', sub)); // the backup cascades
  return r.ok ? json({ ok: true }) : json({ error: 'unavailable' }, 503);
};
