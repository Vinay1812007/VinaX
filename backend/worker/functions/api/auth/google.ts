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
 * to the account. Both go out after the answer (waitUntil).
 */
import { clientIds, issueSession, verifyGoogleIdToken, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q, type DbEnv } from '../../_lib/db';
import { DEVICE_HEADER, resolveIdentity, verifiedIdentity, type IdentityEnv } from '../../_lib/identity';
import { accountFacts, accountOf, CORS, handleOf, json, linkDevice, publicUser } from '../../_lib/authShared';
import { turnstileSiteKey, verifyTurnstile, type TurnstileEnv } from '../../_lib/turnstile';
import { emailConfigured, newSignInEmail, requestFacts, sendLater, welcomeEmail, type EmailEnv } from '../../_lib/email';

type Env = AuthEnv & DbEnv & IdentityEnv & TurnstileEnv & EmailEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
/** What the sign-in screen needs before it shows the Google button. */
export const onRequestGet = async (ctx: { env: Env }): Promise<Response> => json({ turnstileSiteKey: turnstileSiteKey(ctx.env) });

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
  if (dbConfigured(env)) {
    // Console rebuild — a person the owner blocked cannot sign in again.
    const blocked = await db.one<{ blocked_at: string | null }>(env, 'accounts', q().eq('id', profile.sub).select('blocked_at'));
    if (blocked.ok && blocked.value?.blocked_at) return json({ error: 'blocked' }, 403);
  }
  const session = await issueSession(env, profile.sub);
  if (!session) return json({ error: 'not_configured' }, 503);

  let stored = false;
  let username: string | null = null;
  let returning = false;
  let hasData = false;
  let issued: string | null = null;
  if (dbConfigured(env)) {
    const existing = await accountOf(env, profile.sub);
    const prior = existing.ok ? existing.value : null;
    returning = !!prior;
    if (prior) {
      const backup = await db.one<{ account_id: string }>(env, 'account_backups', q().eq('account_id', profile.sub).select('account_id'));
      hasData = backup.ok && !!backup.value;
    }
    // A PROVED device id links; so does the install id of a device that has
    // not reported yet (its row id is derived from a uuid only it knows).
    // A forged signed id links nothing.
    const proved = await verifiedIdentity(env, typeof body.signed_device_id === 'string' ? body.signed_device_id : request.headers.get(DEVICE_HEADER));
    let fromInstall: string | null = null;
    if (!proved && typeof body.deviceId === 'string') {
      const identity = await resolveIdentity(env, { deviceId: body.deviceId });
      if (identity?.source === 'install') {
        fromInstall = identity.id;
        issued = identity.issued;
      }
    }
    const thisDevice = proved ?? fromInstall;
    const listenerId = thisDevice ?? prior?.listener_id ?? null;
    // Was this device already this account's? Read before the link below.
    let newDevice = false;
    if (prior && thisDevice && thisDevice !== prior.listener_id && emailConfigured(env)) {
      const dev = await db.one<{ account_id: string | null }>(env, 'listeners', q().eq('id', thisDevice).select('account_id'));
      newDevice = dev.ok && dev.value?.account_id !== profile.sub;
    }
    const now = new Date().toISOString();
    const facts = accountFacts(request, body);
    const row = {
      id: profile.sub,
      email: profile.email,
      email_verified: profile.emailVerified,
      name: profile.name,
      picture: profile.picture,
      listener_id: listenerId,
      last_seen: now,
      ...facts,
    };
    const written = await db.upsert(env, 'accounts', row, 'id');
    stored = written.ok;
    if (!written.ok) console.warn(`[auth] account not stored (${written.error}${written.status ? ` ${written.status}` : ''}${written.code ? ` ${written.code}` : ''})`);
    else if (thisDevice) {
      await linkDevice(env, thisDevice, profile.sub);
      // Signing in again on a device the owner signed out makes it count again.
      await db.update(env, 'listeners', q().eq('id', thisDevice).not('signed_out_at', 'is', 'null'), { signed_out_at: null });
    }
    username = await handleOf(env, listenerId);
    if (written.ok && profile.email && profile.emailVerified) {
      const where = { ...facts, ...requestFacts(request) };
      if (existing.ok && !prior) void sendLater(env, ctx.waitUntil, 'welcome', () => ({ ...welcomeEmail(profile.email!, profile.name, where), idempotencyKey: `welcome/${profile.sub}` }));
      // One alert per sign-in; the minute in the key only stops a retried request mailing twice.
      else if (prior) void sendLater(env, ctx.waitUntil, 'newSignIn', () => ({ ...newSignInEmail(profile.email!, profile.name, where, newDevice), idempotencyKey: `signin/${profile.sub}/${thisDevice ?? 'unknown'}/${Math.floor(Date.now() / 60_000)}` }));
    }
  }
  return json({ session, stored, returning, hasData, user: publicUser(profile, username), ...(issued ? { signed_device_id_next: issued } : {}) });
};
