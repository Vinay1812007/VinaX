/**
 * 12.2 — POST /api/auth/google { credential, signed_device_id? }
 *   → 200 { session, user: { name, email, picture, username } }
 *   → 401 { error: 'invalid_token' }      the Google token did not verify
 *   → 503 { error: 'not_configured' }     no GOOGLE_CLIENT_ID or no signing secret
 *
 * Signing in is optional; listening never needs it. The first sign-in links
 * the listener's existing VinaX username when the device proves it owns it (a
 * valid signed device id, the same proof /api/username uses). The account row
 * is best effort: when the table is missing the session still works and the
 * answer says `stored: false`.
 */
import { clientIds, issueSession, verifyGoogleIdToken, type AuthEnv } from '../../_lib/googleAuth';
import { resolveIdentity, type IdentityEnv } from '../../_lib/identity';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { sbSelectRes, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { accountFacts, accountOf, CORS, json, publicUser } from '../../_lib/authShared';

type Env = AuthEnv & IdentityEnv & SupabaseEnv;

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

  let username: string | null = null;
  let deviceId: string | null = null;
  let stored = false;
  if (supabaseConfigured(env)) {
    const existing = await accountOf(env, profile.sub);
    username = existing?.username ?? null;
    // Link the device's username only when the device PROVES it owns it.
    const id = typeof body.signed_device_id === 'string' ? await resolveIdentity(request, env, { signed_device_id: body.signed_device_id }) : null;
    if (id?.verified) {
      deviceId = id.deviceId;
      if (!username) {
        const r = await sbSelectRes<{ username: string | null }>(env, 'vinax_users', `device_id=eq.${encodeURIComponent(id.deviceId)}&select=username&limit=1`);
        if (r.ok) username = r.rows[0]?.username ?? null;
      }
    }
    const now = new Date().toISOString();
    const row = {
      google_sub: profile.sub,
      email: profile.email,
      email_verified: profile.emailVerified,
      name: profile.name,
      picture: profile.picture,
      username,
      ...(deviceId ? { device_id: deviceId } : {}),
      last_seen: now,
    };
    // 13.7 — plus the coarse sign-in facts (accountFacts). Before the 13.7
    // columns exist the write is refused; the row is then stored without
    // them, because /api/auth/me signs out a session that has no row.
    stored =
      (await sbUpsert(env, 'vinax_accounts', { ...row, ...accountFacts(request, body) }, 'google_sub')) ||
      (await sbUpsert(env, 'vinax_accounts', row, 'google_sub'));
  }
  return json({ session, stored, user: publicUser({ ...profile, username }) });
};
