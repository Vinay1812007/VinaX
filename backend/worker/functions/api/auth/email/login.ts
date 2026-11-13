/**
 * POST /api/auth/email/login { email, password, turnstile?, signed_device_id?, deviceId?, platform?, appVersion? }
 *   → 200 the sign-in answer of _lib/signIn.ts (method: 'password')
 *   → 400 { error: 'bad_email' }
 *   → 401 { error: 'wrong_password' }   no account with this address and password
 *        (also when the address has an account but no password yet: the app
 *        says "Forgot password?" sets one)
 *   → 403 { error: 'human_check' | 'blocked' }
 *   → 503 { error: 'not_configured' | 'unavailable' }
 *
 * Schema 20. bcrypt runs in the database (account_check_password).
 */
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured } from '../../../_lib/db';
import { accountOf, CORS, json } from '../../../_lib/authShared';
import { verifyTurnstile, type TurnstileEnv } from '../../../_lib/turnstile';
import { normalEmail } from '../../../_lib/emailAuth';
import { finishSignIn, type SignInEnv } from '../../../_lib/signIn';

type Env = SignInEnv & TurnstileEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-email-login', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 8_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  const email = normalEmail(body.email);
  if (!email) return json({ error: 'bad_email' }, 400);
  if (typeof body.password !== 'string' || !body.password || body.password.length > 200) return json({ error: 'wrong_password' }, 401);
  const human = await verifyTurnstile(env, body.turnstile, request, 'app-signin');
  if (human === 'missing' || human === 'failed') return json({ error: 'human_check' }, 403);

  const checked = await db.rpc<string | null>(env, 'account_check_password', { p_email: email, p_password: body.password });
  if (!checked.ok) return json({ error: 'unavailable' }, 503);
  const id = typeof checked.value === 'string' ? checked.value : null;
  if (!id) return json({ error: 'wrong_password' }, 401);
  const acct = await accountOf(env, id);
  if (!acct.ok || !acct.value) return json({ error: 'unavailable' }, 503);
  const a = acct.value;
  return finishSignIn(ctx, { id: a.id, email: a.email, emailVerified: a.email_verified, name: a.name, picture: a.picture }, body, 'password');
};
