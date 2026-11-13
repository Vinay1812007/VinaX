/**
 * GET  /api/auth/google → { turnstileSiteKey }   null when the human check is off
 *
 * POST /api/auth/google { credential, turnstile?, signed_device_id?, deviceId?, platform?, appVersion? }
 *   → 200 { session, stored, returning, hasData, user: { name, email, picture, username }, signed_device_id_next? }
 *        `returning`: this Google account signed in before (its row existed);
 *        `hasData`: it has a synced copy in account_backups. The app skips the
 *        welcome for a returning account and pulls its copy first (15.0 fix:
 *        a registered listener signing in on a new browser was greeted, and
 *        set up, as a new one).
 *   → 401 { error: 'invalid_token' }      the Google token did not verify
 *   → 403 { error: 'blocked' }            the owner blocked this person in the console
 *   → 403 { error: 'human_check' }        Turnstile is on and `turnstile` is missing or did not pass
 *   → 503 { error: 'not_configured' }     no GOOGLE_CLIENT_ID or no signing secret
 *
 * Signing in is optional; listening never needs it. The Google ID token is
 * checked here (signature, issuer, audience, expiry), then VinaX issues its
 * own signed session. The `accounts` row is written best effort: when the
 * database is missing the session still works and the answer says
 * `stored: false`. The device is linked to the account only when it PROVES
 * its signed id (body or the x-vinax-device header), which is how the console
 * shows one listener rather than an account plus a usage row.
 *
 * V2 1.0.1 — a brand-new browser signs in BEFORE it has reported usage, so it
 * has no signed id yet and nothing was linked: the console then listed the
 * person twice (the account, and a "Device only" row once the browser
 * reported). Now the app also sends its install id, the device row it WILL
 * report as (`d_<hmac>` — only that device knows the uuid behind it) is
 * linked right away, and its signed id comes back as `signed_device_id_next`.
 *
 * Emails (_lib/email.ts, off without RESEND_API_KEY): a new account gets a
 * welcome; every later sign-in gets a sign-in alert with the time, browser,
 * IP address and rough place, saying so when the device was not yet linked
 * to the account. Both go out after the answer (waitUntil), to the address in
 * the Google token whether or not it carries `email_verified` (1.12: the
 * Android app's tokens were being refused by that check).
 *
 * Schema 12: every sign-in also writes a `sign_ins` row (time, IP, browser,
 * app, geo, first sign-in / new device), kept 90 days, shown on the user's
 * profile in the console. Best effort: before the database update it fails
 * quietly and the sign-in still works.
 *
 * Schema 20: everything after the token check lives in _lib/signIn.ts, shared
 * with email + password sign-in. A Google account whose address matches an
 * account made with email sign-up signs in to THAT account when the token says
 * the address is verified (Google proved it, and so did the email code), so
 * nobody ends up with two.
 */
import { clientIds, verifyGoogleIdToken, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, like, q, type DbEnv } from '../../_lib/db';
import type { IdentityEnv } from '../../_lib/identity';
import { CORS, json } from '../../_lib/authShared';
import { turnstileSiteKey, verifyTurnstile, type TurnstileEnv } from '../../_lib/turnstile';
import type { EmailEnv } from '../../_lib/email';
import { finishSignIn } from '../../_lib/signIn';

type Env = AuthEnv & DbEnv & IdentityEnv & TurnstileEnv & EmailEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
/** What the sign-in screen needs before it shows the Google button. */
export const onRequestGet = async (ctx: { env: Env }): Promise<Response> => json({ turnstileSiteKey: turnstileSiteKey(ctx.env) });

/**
 * The account a Google sign-in lands in: Google's own id, unless no account
 * has that id yet and an email-sign-up account (`em…`) has the same address.
 */
async function accountIdFor(env: Env, sub: string, email: string | null, verified: boolean): Promise<string> {
  // Only an address Google says it checked may join an existing account.
  if (!email || !verified || !dbConfigured(env)) return sub;
  const own = await db.one<{ id: string }>(env, 'accounts', q().eq('id', sub).select('id'));
  if (!own.ok || own.value) return sub;
  const byEmail = await db.one<{ id: string }>(env, 'accounts', q().ilike('email', like(email)).ilike('id', 'em*').select('id').limit(1));
  return byEmail.ok && byEmail.value ? byEmail.value.id : sub;
}

export const onRequestPost = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-google', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  if (!clientIds(env).length) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 16_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  // Cloudflare Turnstile (when the owner has set its keys). If Siteverify
  // can't be reached the Google token below is still the proof of who this is.
  const human = await verifyTurnstile(env, body.turnstile, request, 'app-signin');
  if (human === 'missing' || human === 'failed') return json({ error: 'human_check' }, 403);
  const profile = await verifyGoogleIdToken(env, body.credential);
  if (!profile) return json({ error: 'invalid_token' }, 401);
  const id = await accountIdFor(env, profile.sub, profile.email, profile.emailVerified);
  return finishSignIn(ctx, { id, email: profile.email, emailVerified: profile.emailVerified, name: profile.name, picture: profile.picture }, body, 'google');
};
