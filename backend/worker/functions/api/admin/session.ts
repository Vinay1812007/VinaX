/**
 * Version 8 — console sign-in.
 *
 * GET  /api/admin/session            → { googleClientId, googleReady, passwordAllowed, me, schema, schemaWanted, databaseConfigured }
 *        Public facts the sign-in screen needs; with a valid token also `me`
 *        (email, name, picture, role, via). Never 401: the sign-in screen asks it.
 * POST /api/admin/session { credential } → { token, me, expiresIn }
 *        A Google ID token. Only a verified email on the `admins` list (or in
 *        ADMIN_OWNER_EMAILS) gets a console session. 403 not_an_admin otherwise.
 */
import { adminJson, adminPrincipal, badRequest, type AdminAuthEnv } from '../../_lib/admin';
import { ADMIN_SESSION_TTL_S, adminRowOf, bootstrapOwners, googleSignInReady, issueAdminSession, normEmail, resetAdminMemo } from '../../_lib/adminAuth';
import { audit } from '../../_lib/audit';
import { readJsonCapped } from '../../_lib/body';
import { db, dbConfigured, q } from '../../_lib/db';
import { clientIds, verifyGoogleIdToken } from '../../_lib/googleAuth';
import { bindingAllows, clientKey } from '../../_lib/ratelimit';

type Env = AdminAuthEnv & Record<string, unknown>;

/** The schema.sql version this Worker is written against. */
export const SCHEMA_WANTED = 8;

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
    me: me ? { email: me.email, name: me.name, picture: me.picture, role: me.role, via: me.via } : null,
  });
};

export const onRequestPost = async (ctx: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  if (!googleSignInReady(env)) return adminJson({ error: 'google_not_configured' }, 503);
  // Bound how fast one address can try tokens (a valid Google token is hard to forge anyway).
  if ((await bindingAllows(env, 'ADMIN_AUTH_FAILS', `admin-google|${clientKey(request, env)}`)) === false) return adminJson({ error: 'rate_limited' }, 429);
  const read = await readJsonCapped<{ credential?: unknown } | null>(request, 8 * 1024);
  if (!read.ok || !read.value || typeof read.value !== 'object') return badRequest();
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
  return adminJson({
    token,
    expiresIn: ADMIN_SESSION_TTL_S,
    me: { email, name: profile.name, picture: profile.picture, role: row.role, via: 'google' },
  });
};
