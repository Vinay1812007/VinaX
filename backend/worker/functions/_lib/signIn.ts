/**
 * What every way of signing in to the app shares, once it knows WHO this is
 * (a verified Google token, a right email + password, or a right email
 * code): the blocked check, VinaX's own session, the `accounts` row, linking
 * this device, the `sign_ins` row and the welcome / sign-in alert emails.
 *
 * Moved here from api/auth/google.ts when email and password sign-in came
 * (schema 20); the Google route's behaviour is unchanged.
 */
import { issueSession, type AuthEnv } from './googleAuth';
import { db, dbConfigured, q, type DbEnv } from './db';
import { resolveIdentity, verifiedIdentity, DEVICE_HEADER, type IdentityEnv } from './identity';
import { accountFacts, accountOf, handleOf, json, linkDevice, publicUser } from './authShared';
import { newSignInEmail, requestFacts, sendLater, welcomeEmail, type EmailEnv } from './email';

export type SignInEnv = AuthEnv & DbEnv & IdentityEnv & EmailEnv;
export type SignInMethod = 'google' | 'password' | 'email';

/** Who is signing in, already proved by the caller. */
export interface SignInPerson {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface SignInCtx {
  request: Request;
  env: SignInEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}

/** An email account's id: `em` + 24 hex characters (Google accounts keep Google's numeric id). */
export function newEmailAccountId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `em${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Does this account have a password? False when the database cannot say. */
export async function hasPassword(env: DbEnv, accountId: string): Promise<boolean> {
  if (!dbConfigured(env)) return false;
  const r = await db.rpc<boolean>(env, 'account_has_password', { p_account: accountId });
  return r.ok && r.value === true;
}

/**
 * Finish a sign-in: 200 { session, stored, returning, hasData, method, user, signed_device_id_next? },
 * 403 { error: 'blocked' }, or 503 { error: 'not_configured' }.
 */
export async function finishSignIn(
  ctx: SignInCtx,
  person: SignInPerson,
  body: Record<string, unknown>,
  method: SignInMethod,
  /** Runs once the account row is stored, before the session is handed out; a false answer becomes 503 unavailable. */
  afterStore?: () => Promise<boolean>,
): Promise<Response> {
  const { request, env } = ctx;
  if (dbConfigured(env)) {
    // Console rebuild — a person the owner blocked cannot sign in again.
    const blocked = await db.one<{ blocked_at: string | null }>(env, 'accounts', q().eq('id', person.id).select('blocked_at'));
    if (blocked.ok && blocked.value?.blocked_at) return json({ error: 'blocked' }, 403);
  }
  const session = await issueSession(env, person.id);
  if (!session) return json({ error: 'not_configured' }, 503);

  let stored = false;
  let username: string | null = null;
  let returning = false;
  let hasData = false;
  let issued: string | null = null;
  let password = method === 'password';
  if (dbConfigured(env)) {
    const existing = await accountOf(env, person.id);
    const prior = existing.ok ? existing.value : null;
    returning = !!prior;
    if (prior) {
      const backup = await db.one<{ account_id: string }>(env, 'account_backups', q().eq('account_id', person.id).select('account_id'));
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
    if (prior && thisDevice && thisDevice !== prior.listener_id) {
      const dev = await db.one<{ account_id: string | null }>(env, 'listeners', q().eq('id', thisDevice).select('account_id'));
      newDevice = dev.ok && dev.value?.account_id !== person.id;
    }
    const now = new Date().toISOString();
    const facts = accountFacts(request, body);
    const row = {
      id: person.id,
      email: person.email,
      email_verified: person.emailVerified,
      name: person.name,
      picture: person.picture,
      listener_id: listenerId,
      last_seen: now,
      ...facts,
    };
    const written = await db.upsert(env, 'accounts', row, 'id');
    stored = written.ok;
    if (!written.ok) console.warn(`[auth] account not stored (${written.error}${written.status ? ` ${written.status}` : ''}${written.code ? ` ${written.code}` : ''})`);
    else if (thisDevice) {
      await linkDevice(env, thisDevice, person.id);
      // Signing in again on a device the owner signed out makes it count again.
      await db.update(env, 'listeners', q().eq('id', thisDevice).not('signed_out_at', 'is', 'null'), { signed_out_at: null });
    }
    if (afterStore) {
      if (!written.ok || !(await afterStore())) return json({ error: 'unavailable' }, 503);
      password = true;
    }
    username = await handleOf(env, listenerId);
    if (!password && prior) password = await hasPassword(env, person.id);
    const where = { ...facts, ...requestFacts(request) };
    if (written.ok) {
      const record = db.insert(env, 'sign_ins', {
        account_id: person.id, at: now, ip: where.ip, browser: where.browser, platform: facts.platform, app_version: facts.app_version,
        country: facts.country, region: facts.region, city: facts.city, new_device: newDevice, signup: existing.ok && !prior,
      }).then((r) => { if (!r.ok) console.warn(`[auth] sign-in not recorded (${r.error}${r.status ? ` ${r.status}` : ''})`); });
      if (ctx.waitUntil) ctx.waitUntil(record);
      else await record;
    }
    // 1.12 — the address Google puts in the ID token is the account's own, so
    // the emails go to it whether or not the token says `email_verified`
    // (some Android sign-ins, and Workspace accounts, carry no such claim;
    // those listeners never got a welcome or a sign-in alert).
    if (written.ok && person.email) {
      if (!person.emailVerified) console.warn(`[auth] ${facts.platform} sign-in with an unverified email claim; emails still sent`);
      if (existing.ok && !prior) void sendLater(env, ctx.waitUntil, 'welcome', () => ({ ...welcomeEmail(person.email!, person.name, where), idempotencyKey: `welcome/${person.id}` }));
      // One alert per sign-in; the minute in the key only stops a retried request mailing twice.
      else if (prior) void sendLater(env, ctx.waitUntil, 'newSignIn', () => ({ ...newSignInEmail(person.email!, person.name, where, newDevice), idempotencyKey: `signin/${person.id}/${thisDevice ?? 'unknown'}/${Math.floor(Date.now() / 60_000)}` }));
    } else if (!written.ok || !person.email) {
      console.warn(`[auth] no email sent: ${!written.ok ? 'account not stored' : 'token carries no email'} (${facts.platform})`);
    }
  }
  return json({
    session, stored, returning, hasData, method,
    user: { ...publicUser(person, username), hasPassword: password },
    ...(issued ? { signed_device_id_next: issued } : {}),
  });
}
