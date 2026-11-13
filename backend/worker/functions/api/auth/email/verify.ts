/**
 * POST /api/auth/email/verify { email, code, password, name?, signed_device_id?, deviceId?, platform?, appVersion? }
 *   → 200 the sign-in answer of _lib/signIn.ts (method: 'email')
 *   → 400 { error: 'bad_email' | 'bad_code' | 'password_short' | 'password_long' }
 *   → 400 { error: 'code_expired' }           no code for this address, it ran out, or too many wrong tries
 *   → 400 { error: 'wrong_code', triesLeft }
 *   → 403 { error: 'blocked' }                the owner blocked this person in the console
 *   → 503 { error: 'not_configured' | 'unavailable' }
 *
 * Schema 20. The right code proves the address, then:
 *   - no account has it → a new email account (`em…`) with this password and name;
 *   - an account has it (a Google account, or an email one) → that account's
 *     password is set to this one ("Forgot password?", or a Google listener
 *     adding a password from the sign-in screen), and it is signed in.
 */
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../../_lib/db';
import { CORS, json } from '../../../_lib/authShared';
import { accountByEmail, cleanName, CODE_TRIES, codeHash, normalEmail, passwordProblem, sameHash, type CodeRow } from '../../../_lib/emailAuth';
import { finishSignIn, newEmailAccountId, type SignInEnv, type SignInPerson } from '../../../_lib/signIn';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (ctx: { request: Request; env: SignInEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-email-verify', { capacity: 10, refillPerMinute: 5 }, env);
  if (limited) return limited;
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 8_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  const email = normalEmail(body.email);
  if (!email) return json({ error: 'bad_email' }, 400);
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) return json({ error: 'bad_code' }, 400);
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: `password_${problem}` }, 400);
  const password = body.password as string;

  const row = await db.one<CodeRow>(env, 'email_codes', q().eq('email', email));
  if (!row.ok) return json({ error: 'unavailable' }, 503);
  const pending = row.value;
  if (!pending || Date.parse(pending.expires_at) < Date.now() || pending.tries >= CODE_TRIES) {
    if (pending) await db.remove(env, 'email_codes', q().eq('email', email));
    return json({ error: 'code_expired' }, 400);
  }
  const hash = await codeHash(env, email, code);
  if (!hash) return json({ error: 'not_configured' }, 503);
  if (!sameHash(hash, pending.code_hash)) {
    const tries = pending.tries + 1;
    if (tries >= CODE_TRIES) await db.remove(env, 'email_codes', q().eq('email', email));
    else await db.update(env, 'email_codes', q().eq('email', email), { tries });
    return tries >= CODE_TRIES ? json({ error: 'code_expired' }, 400) : json({ error: 'wrong_code', triesLeft: CODE_TRIES - tries }, 400);
  }

  const owner = await accountByEmail(env, email);
  if (!owner.ok) return json({ error: 'unavailable' }, 503);
  const a = owner.row;
  const person: SignInPerson = a
    ? { id: a.id, email: a.email ?? email, emailVerified: true, name: a.name, picture: a.picture }
    : { id: newEmailAccountId(), email, emailVerified: true, name: cleanName(body.name), picture: null };
  const res = await finishSignIn(ctx, person, body, 'email', async () => {
    const set = await db.rpc<boolean>(env, 'account_set_password', { p_account: person.id, p_password: password });
    return set.ok && set.value === true;
  });
  // The code is spent once it has signed someone in (a blocked person keeps nothing either).
  if (res.status === 200 || res.status === 403) await db.remove(env, 'email_codes', q().eq('email', email));
  return res;
};
