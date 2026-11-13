/**
 * Settings › Account › Password (schema 20), for the signed-in listener.
 *
 * GET  /api/auth/password   (Authorization: Bearer <session>)
 *   → 200 { hasPassword }
 * POST /api/auth/password { password, current? }
 *   → 200 { ok: true }                 the password is set; email + password sign-in works now
 *   → 400 { error: 'password_short' | 'password_long' }
 *   → 403 { error: 'wrong_password' }  the account already has a password and `current` is not it
 *   → 401 { error: 'signed_out' }
 *   → 503 { error: 'not_configured' | 'unavailable' }
 *
 * A Google listener sets a first password with no `current` (the session is
 * the proof). Changing an existing one needs the old one; a forgotten one is
 * reset with an email code from the sign-in screen (api/auth/email/verify).
 */
import { bearer, readSession, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { CORS, json } from '../../_lib/authShared';
import { passwordProblem } from '../../_lib/emailAuth';
import { hasPassword } from '../../_lib/signIn';

type Env = AuthEnv & DbEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  return json({ hasPassword: await hasPassword(env, sub) });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-password', { capacity: 5, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 4_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: `password_${problem}` }, 400);
  if (await hasPassword(env, sub)) {
    const current = typeof body.current === 'string' && body.current.length <= 200 ? body.current : '';
    const ok = current ? await db.rpc<string | null>(env, 'account_check_password', { p_account: sub, p_password: current }) : null;
    if (!ok?.ok || ok.value !== sub) return json({ error: 'wrong_password' }, 403);
  }
  const set = await db.rpc<boolean>(env, 'account_set_password', { p_account: sub, p_password: body.password });
  if (!set.ok) return json({ error: 'unavailable' }, 503);
  return set.value === true ? json({ ok: true }) : json({ error: 'signed_out' }, 401);
};
