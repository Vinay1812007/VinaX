/**
 * 12.2 — GET /api/auth/me (Authorization: Bearer <session>)
 *   → 200 { user } | 401 { error: 'signed_out' }
 * POST /api/auth/me { delete: true } removes the account row: the listener's
 * Google id, email, name and picture leave the server. Listening history and
 * the library were never on it.
 */
import { bearer, readSession, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { sbDelete, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { resolveIdentity, type IdentityEnv } from '../../_lib/identity';
import { accountOf, CORS, DEVICE_HEADER, json, publicUser, type AccountRow } from '../../_lib/authShared';

type Env = AuthEnv & SupabaseEnv & IdentityEnv;

/** How stale the account's last_seen may get before a session check refreshes it. */
export const TOUCH_MS = 10 * 60_000;

/**
 * 13.6.4 — keep the account row current for User Management. The welcome
 * (and its "share usage" tick) comes AFTER sign-in, so a new listener's
 * device has no signed id yet when the account is written and the account
 * stays unlinked. The app sends the device's signed id on this check; a
 * valid one links the device, so the console shows one listener, not an
 * account row plus a usage row. last_seen is refreshed at most every
 * TOUCH_MS. Best effort: a failed write never affects the answer.
 */
export async function touchAccount(request: Request, env: Env, row: Pick<AccountRow, 'google_sub' | 'device_id' | 'last_seen'>): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  const signed = request.headers.get(DEVICE_HEADER);
  if (signed) {
    const id = await resolveIdentity(request, env, { signed_device_id: signed });
    if (id.verified && id.deviceId !== row.device_id) patch.device_id = id.deviceId;
  }
  const last = Date.parse(row.last_seen ?? '');
  if (patch.device_id || !Number.isFinite(last) || Date.now() - last > TOUCH_MS) patch.last_seen = new Date().toISOString();
  if (!Object.keys(patch).length) return false;
  return sbUpdate(env, 'vinax_accounts', `google_sub=eq.${encodeURIComponent(row.google_sub)}`, patch).catch(() => false);
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const row = await accountOf(ctx.env, sub);
  if (row === undefined) return json({ error: 'unavailable' }, 503);
  if (!row) return json({ error: 'signed_out' }, 401);
  const touch = touchAccount(ctx.request, ctx.env, row);
  if (ctx.waitUntil) ctx.waitUntil(touch);
  else await touch;
  return json({ user: publicUser(row) });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-me', { capacity: 5, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const read = await readJsonCapped<{ delete?: unknown } | null>(request, 1_000);
  if (!read.ok || read.value?.delete !== true) return json({ error: 'bad_request' }, 400);
  const ok = await sbDelete(env, 'vinax_accounts', `google_sub=eq.${encodeURIComponent(sub)}`);
  return ok ? json({ ok: true }) : json({ error: 'unavailable' }, 503);
};
