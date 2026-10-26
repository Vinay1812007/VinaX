/**
 * POST /api/auth/google { credential, signed_device_id?, deviceId?, platform?, appVersion? }
 *   → 200 { session, stored, returning, hasData, user: { name, email, picture, username }, signed_device_id_next? }
 *        `returning`: this Google account signed in before (its row existed);
 *        `hasData`: it has a synced copy in account_backups. The app skips the
 *        welcome for a returning account and pulls its copy first (15.0 fix:
 *        a registered listener signing in on a new browser was greeted, and
 *        set up, as a new one).
 *   → 401 { error: 'invalid_token' }      the Google token did not verify
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
 */
import { clientIds, issueSession, verifyGoogleIdToken, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q, type DbEnv } from '../../_lib/db';
import { DEVICE_HEADER, resolveIdentity, verifiedIdentity, type IdentityEnv } from '../../_lib/identity';
import { accountFacts, accountOf, CORS, handleOf, json, linkDevice, publicUser } from '../../_lib/authShared';

type Env = AuthEnv & DbEnv & IdentityEnv;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
export const onRequestGet = async (): Promise<Response> => json({ error: 'method_not_allowed' }, 405);

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'auth-google', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  if (!clientIds(env).length) return json({ error: 'not_configured' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 16_000);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  const profile = await verifyGoogleIdToken(env, body.credential);
  if (!profile) return json({ error: 'invalid_token' }, 401);
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
    const now = new Date().toISOString();
    const row = {
      id: profile.sub,
      email: profile.email,
      email_verified: profile.emailVerified,
      name: profile.name,
      picture: profile.picture,
      listener_id: listenerId,
      last_seen: now,
      ...accountFacts(request, body),
    };
    const written = await db.upsert(env, 'accounts', row, 'id');
    stored = written.ok;
    if (!written.ok) console.warn(`[auth] account not stored (${written.error}${written.status ? ` ${written.status}` : ''}${written.code ? ` ${written.code}` : ''})`);
    else if (thisDevice) await linkDevice(env, thisDevice, profile.sub);
    username = await handleOf(env, listenerId);
  }
  return json({ session, stored, returning, hasData, user: publicUser(profile, username), ...(issued ? { signed_device_id_next: issued } : {}) });
};
