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
import { sbDelete, type SupabaseEnv } from '../../_lib/supabase';
import { accountOf, CORS, json, publicUser } from '../../_lib/authShared';

type Env = AuthEnv & SupabaseEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const row = await accountOf(ctx.env, sub);
  if (row === undefined) return json({ error: 'unavailable' }, 503);
  if (!row) return json({ error: 'signed_out' }, 401);
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
