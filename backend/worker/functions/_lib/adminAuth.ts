/**
 * Console rebuild — who is using the console, and what they may do.
 *
 * Two ways in:
 *   1. Google sign-in (the normal way). POST /api/admin/session with a Google
 *      ID token; when the verified email is on the `admins` list (or in the
 *      ADMIN_OWNER_EMAILS bootstrap var) the Worker answers a console session
 *      `adm1.<payload>.<hmac>` (12 hours), which the console sends as
 *      `x-admin-token`. The role is read from `admins` on each request
 *      (memoised a minute), so a demotion or removal applies within a minute.
 *   2. The owner password (ADMIN_LOGIN_PASSWORD) — the recovery key. It acts
 *      as an owner named "owner", so a fresh console can invite its first
 *      admin. Removing the secret turns it off.
 *
 * Roles: viewer < editor < owner. GETs need any role; writes need editor
 * unless the route asks for owner (database upkeep, admins, deleting a
 * user's data, clearing errors).
 */
import { db, dbConfigured, q, type DbEnv } from './db';
import { clientIds, type AuthEnv } from './googleAuth';

export type AdminRole = 'viewer' | 'editor' | 'owner';
export const ADMIN_ROLES: readonly AdminRole[] = ['viewer', 'editor', 'owner'];
export const isAdminRole = (v: unknown): v is AdminRole => typeof v === 'string' && (ADMIN_ROLES as readonly string[]).includes(v);

export interface AdminPrincipal {
  /** The admin's email, or "owner" for the recovery password. */
  email: string;
  name: string | null;
  picture: string | null;
  role: AdminRole;
  via: 'google' | 'password';
}

export interface AdminSessionEnv extends AuthEnv, DbEnv {
  /** Comma-separated emails that are always owners (bootstrap). */
  ADMIN_OWNER_EMAILS?: string;
}

export const ADMIN_SESSION_TTL_S = 12 * 3600;
const RANK: Record<AdminRole, number> = { viewer: 0, editor: 1, owner: 2 };
export const roleAllows = (role: AdminRole, need: AdminRole): boolean => RANK[role] >= RANK[need];

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const secretOf = (env: AuthEnv): string | null => env.AUTH_SECRET?.trim() || env.DEVICE_ID_SECRET?.trim() || env.TELEMETRY_PEPPER?.trim() || null;

async function sign(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`admin-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

export const normEmail = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
};

/** Emails in ADMIN_OWNER_EMAILS. */
export function bootstrapOwners(env: AdminSessionEnv): string[] {
  return (env.ADMIN_OWNER_EMAILS ?? '').split(',').map(normEmail).filter((e): e is string => !!e);
}

/** A console session for this email. Null without a signing secret. */
export async function issueAdminSession(env: AuthEnv, email: string, now = Date.now()): Promise<string | null> {
  const secret = secretOf(env);
  if (!secret) return null;
  const iat = Math.floor(now / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ email, iat, exp: iat + ADMIN_SESSION_TTL_S })));
  return `adm1.${payload}.${await sign(secret, payload)}`;
}

/** The email a console session belongs to, or null (forged, expired, malformed). */
export async function readAdminSession(env: AuthEnv, token: string, now = Date.now()): Promise<string | null> {
  try {
    const secret = secretOf(env);
    const m = /^adm1\.([A-Za-z0-9_-]{10,600})\.([A-Za-z0-9_-]{20,100})$/.exec(token);
    if (!secret || !m) return null;
    const want = await sign(secret, m[1]);
    if (want.length !== m[2].length) return null;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
    if (diff !== 0) return null;
    const p = JSON.parse(fromB64url(m[1])) as { email?: unknown; exp?: unknown };
    const email = normEmail(p.email);
    if (!email || typeof p.exp !== 'number' || p.exp < Math.floor(now / 1000)) return null;
    return email;
  } catch {
    return null;
  }
}

export const looksLikeAdminSession = (token: string): boolean => token.startsWith('adm1.');

export interface AdminRow { email: string; name: string | null; picture: string | null; role: AdminRole; invited_by: string | null; created_at: string; last_sign_in: string | null }

const MEMO_MS = 60_000;
const memo = new Map<string, { at: number; row: AdminRow | null }>();
/** Tests and admin edits: forget cached roles. */
export function resetAdminMemo(): void {
  memo.clear();
}

/** The admins row for an email (bootstrap owners count even without one). Memoised a minute. */
export async function adminRowOf(env: AdminSessionEnv, email: string, now = Date.now()): Promise<AdminRow | null> {
  const hit = memo.get(email);
  if (hit && now - hit.at < MEMO_MS) return hit.row;
  let row: AdminRow | null = null;
  if (dbConfigured(env)) {
    const r = await db.one<AdminRow>(env, 'admins', q().eq('email', email).select('email,name,picture,role,invited_by,created_at,last_sign_in'));
    if (r.ok) row = r.value && isAdminRole(r.value.role) ? r.value : null;
    else if (!bootstrapOwners(env).includes(email)) return null; // unreadable: refuse, never cache
  }
  if (bootstrapOwners(env).includes(email)) {
    row = { email, name: row?.name ?? null, picture: row?.picture ?? null, role: 'owner', invited_by: row?.invited_by ?? null, created_at: row?.created_at ?? new Date(now).toISOString(), last_sign_in: row?.last_sign_in ?? null };
  }
  if (memo.size > 500) memo.clear();
  memo.set(email, { at: now, row });
  return row;
}

/** A Google session token → the principal, or null. */
export async function principalFromSession(env: AdminSessionEnv, token: string, now = Date.now()): Promise<AdminPrincipal | null> {
  const email = await readAdminSession(env, token, now);
  if (!email) return null;
  const row = await adminRowOf(env, email, now);
  if (!row) return null;
  return { email, name: row.name, picture: row.picture, role: row.role, via: 'google' };
}

export const PASSWORD_PRINCIPAL: AdminPrincipal = { email: 'owner', name: 'Owner (recovery password)', picture: null, role: 'owner', via: 'password' };

/** Is Google sign-in possible for the console at all? */
export const googleSignInReady = (env: AuthEnv): boolean => clientIds(env).length > 0 && !!secretOf(env);
