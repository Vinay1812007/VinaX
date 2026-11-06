/**
 * Console rebuild — console sign-in.
 *
 * GET  /api/admin/session            → { googleClientId, googleReady, passwordAllowed, turnstileSiteKey, me, schema, schemaWanted, databaseConfigured }
 *        Public facts the sign-in screen needs; with a valid token also `me`
 *        (email, name, picture, role, via). Never 401: the sign-in screen asks it.
 *        `turnstileSiteKey`: Cloudflare Turnstile is on (null when off).
 * POST /api/admin/session { credential, turnstile? } → { token, me, expiresIn }
 *        A Google ID token. Only a verified email on the `admins` list (or in
 *        ADMIN_OWNER_EMAILS) gets a console session. 403 not_an_admin otherwise.
 * POST /api/admin/session { password, turnstile? } → { token, me, expiresIn }
 *        The owner recovery password, traded for a 12-hour password session.
 *        With Turnstile on this is the only way the password works.
 *        401 wrong_password (also while locked out after too many tries).
 *
 * With Turnstile on, a sign-in without a passed check gets 403 human_check.
 * If Cloudflare's check can't be reached, Google sign-in still goes ahead
 * (the Google token proves who it is) but the password is refused
 * (503 human_check_unavailable).
 */
import { adminJson, adminPrincipal, badRequest, ownerPasswordMatches, type AdminAuthEnv } from '../../_lib/admin';
import { ADMIN_SESSION_TTL_S, adminRowOf, bootstrapOwners, googleSignInReady, issueAdminSession, issuePasswordSession, normEmail, ownerEmails, PASSWORD_PRINCIPAL, resetAdminMemo } from '../../_lib/adminAuth';
import { consoleSignInEmail, requestFacts, sendLater, type EmailEnv } from '../../_lib/email';
import { edgeGeo, platformOf } from '../../_lib/edge';
import { turnstileSiteKey, verifyTurnstile } from '../../_lib/turnstile';
import { audit } from '../../_lib/audit';
import { readJsonCapped } from '../../_lib/body';
import { db, dbConfigured, q } from '../../_lib/db';
import { clientIds, verifyGoogleIdToken } from '../../_lib/googleAuth';
import { bindingAllows, clientKey } from '../../_lib/ratelimit';

type Env = AdminAuthEnv & Record<string, unknown>;

/** The schema.sql version this Worker is written against. */
export const SCHEMA_WANTED = 11;

export const onRequestGet = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const me = await adminPrincipal(request, env);
  // Signed in: also the database's schema version, so the console can say
  // "run the database update" when the Worker is ahead of the database.
  let schema: number | null = null;
  if (me && dbConfigured(env)) {
    const r = await db.one<{ value: { version?: number } }>(env, 'meta', q().eq('key', 'schema').select('value'));
    schema = r.ok ? Number(r.value?.value?.version) || null : null;
  }
  return adminJson({
    schema,
    schemaWanted: SCHEMA_WANTED,
    databaseConfigured: dbConfigured(env),
    googleClientId: clientIds(env)[0] ?? null,
    googleReady: googleSignInReady(env),
    passwordAllowed: !!env.ADMIN_LOGIN_PASSWORD,
    turnstileSiteKey: turnstileSiteKey(env),
    me: me ? { email: me.email, name: me.name, picture: me.picture, role: me.role, via: me.via } : null,
  });
};

export const onRequestPost = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const read = await readJsonCapped<{ credential?: unknown; password?: unknown; turnstile?: unknown } | null>(request, 8 * 1024);
  if (!read.ok || !read.value || typeof read.value !== 'object') return badRequest();
  if (typeof read.value.password === 'string') return passwordSignIn(ctx, read.value.password, read.value.turnstile);
  if (!googleSignInReady(env)) return adminJson({ error: 'google_not_configured' }, 503);
  // Bound how fast one address can try tokens (a valid Google token is hard to forge anyway).
  if ((await bindingAllows(env, 'ADMIN_AUTH_FAILS', `admin-google|${clientKey(request, env)}`)) === false) return adminJson({ error: 'rate_limited' }, 429);
  // Cloudflare's check unreachable: the Google token is still the proof.
  const human = await verifyTurnstile(env, read.value.turnstile, request, 'console-signin');
  if (human === 'missing' || human === 'failed') return adminJson({ error: 'human_check' }, 403);
  const profile = await verifyGoogleIdToken(env, read.value.credential);
  if (!profile) return adminJson({ error: 'invalid_token' }, 401);
  const email = normEmail(profile.email);
  if (!email || !profile.emailVerified) return adminJson({ error: 'email_not_verified' }, 403);

  resetAdminMemo();
  const row = await adminRowOf(env, email);
  if (!row) {
    if (dbConfigured(env)) await audit({ env, request, waitUntil: ctx.waitUntil, actor: email }, { action: 'admin-signin-refused', summary: `${email} tried to sign in but is not an admin`, target: email });
    return adminJson({ error: 'not_an_admin', email }, 403);
  }
  const token = await issueAdminSession(env, email);
  if (!token) return adminJson({ error: 'google_not_configured' }, 503);
  if (dbConfigured(env)) {
    const now = new Date().toISOString();
    // Keep the name and photo fresh; a bootstrap owner gets a row the first time.
    if (bootstrapOwners(env).includes(email)) {
      await db.upsert(env, 'admins', { email, name: profile.name, picture: profile.picture, role: 'owner', last_sign_in: now }, 'email');
    } else {
      await db.update(env, 'admins', q().eq('email', email), { name: profile.name, picture: profile.picture, last_sign_in: now });
    }
    resetAdminMemo();
    await audit({ env, request, waitUntil: ctx.waitUntil, actor: email }, { action: 'admin-signin', summary: `${email} signed in (${row.role})`, target: email });
  }
  void sendLater(env as EmailEnv, ctx.waitUntil, 'consoleSignIn', () => consoleSignInEmail(email, email, row.role, 'google', signInFacts(request)));
  return adminJson({
    token,
    expiresIn: ADMIN_SESSION_TTL_S,
    me: { email, name: profile.name, picture: profile.picture, role: row.role, via: 'google' },
  });
};

/** The recovery password, after the human check, traded for a password session. */
async function passwordSignIn(ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }, password: string, turnstile: unknown): Promise<Response> {
  const { request, env } = ctx;
  if (!env.ADMIN_LOGIN_PASSWORD) return adminJson({ error: 'password_off' }, 403);
  if (password.length > 512) return badRequest();
  const human = await verifyTurnstile(env, turnstile, request, 'console-signin');
  if (human === 'unavailable') return adminJson({ error: 'human_check_unavailable' }, 503);
  if (human !== 'ok') return adminJson({ error: 'human_check' }, 403);
  if (!(await ownerPasswordMatches(request, env, password))) return adminJson({ error: 'wrong_password' }, 401);
  const token = await issuePasswordSession(env, password);
  if (!token) return adminJson({ error: 'not_configured' }, 503);
  const me = PASSWORD_PRINCIPAL;
  if (dbConfigured(env)) await audit({ env, request, waitUntil: ctx.waitUntil, actor: me.email }, { action: 'admin-signin', summary: 'Owner signed in with the recovery password', target: me.email });
  // The recovery password has no inbox of its own: every owner hears of it.
  void sendLater(env as EmailEnv, ctx.waitUntil, 'consoleSignIn', async () => consoleSignInEmail(await ownerEmails(env), 'Someone', 'owner', 'password', signInFacts(request)));
  return adminJson({ token, expiresIn: ADMIN_SESSION_TTL_S, me: { email: me.email, name: me.name, picture: me.picture, role: me.role, via: me.via } });
}

/** Where the console sign-in came from, for the alert email. */
function signInFacts(request: Request) {
  return { ...edgeGeo(request), platform: platformOf(null, request), ...requestFacts(request) };
}
