/**
 * POST /api/auth/google { credential, signed_device_id?, platform?, appVersion? }
 *   → 200 { session, stored, user: { name, email, picture, username } }
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
 */
import { clientIds, issueSession, verifyGoogleIdToken, type AuthEnv } from '../../_lib/googleAuth';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { DEVICE_HEADER, verifiedIdentity, type IdentityEnv } from '../../_lib/identity';
import { accountFacts, accountOf, CORS, handleOf, json, publicUser } from '../../_lib/authShared';

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
  if (dbConfigured(env)) {
    const existing = await accountOf(env, profile.sub);
    const prior = existing.ok ? existing.value : null;
    // Only a PROVED device id links; a forged or stale claim links nothing.
    const proved = await verifiedIdentity(env, typeof body.signed_device_id === 'string' ? body.signed_device_id : request.headers.get(DEVICE_HEADER));
    const listenerId = proved ?? prior?.listener_id ?? null;
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
    username = await handleOf(env, listenerId);
  }
  return json({ session, stored, user: publicUser(profile, username) });
};
