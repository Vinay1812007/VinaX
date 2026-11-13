/**
 * Schema 20 — email and password sign-in, next to Google.
 *
 * Passwords are hashed with bcrypt inside the database (pgcrypto, functions
 * account_set_password / account_check_password): the free-plan Worker has
 * about 10 ms of CPU per request, far too little for a slow password hash.
 * A password is 8 to 72 bytes (bcrypt reads no further than 72).
 *
 * An email address is proved with a 6-digit code (email_codes): the code is
 * stored as a keyed SHA-256, lives 15 minutes, allows 5 wrong tries and may
 * be re-sent once a minute.
 */
import { sessionSecret, type AuthEnv } from './googleAuth';
import { db, like, q, type DbEnv } from './db';
import { safeEqual } from './safe-compare';
import type { AccountRow } from './authShared';

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_TRIES = 5;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A plausible email address, lower-cased and trimmed, or null. */
export function normalEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Why a password cannot be used, or null when it can. */
export function passwordProblem(v: unknown): 'short' | 'long' | null {
  if (typeof v !== 'string') return 'short';
  const bytes = new TextEncoder().encode(v).length;
  if (v.length < 8) return 'short';
  if (bytes > 72) return 'long';
  return null;
}

/** A display name from the sign-up form: 1–80 characters, or null. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = [...v].filter((ch) => ch.charCodeAt(0) > 31 && ch !== '\u007f' && ch !== '<' && ch !== '>').join('').replace(/\s+/g, ' ').trim();
  return n ? n.slice(0, 80) : null;
}

/** Six random digits. */
export function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

export async function codeHash(env: AuthEnv, email: string, code: string): Promise<string | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`email-code:${secret}:${email}:${code}`)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const sameHash = (a: string, b: string): boolean => safeEqual(a, b);

/** The account that owns this address (the oldest, if more than one), or null. */
export async function accountByEmail(env: DbEnv, email: string): Promise<{ ok: true; row: AccountRow | null } | { ok: false }> {
  const r = await db.one<AccountRow>(env, 'accounts', q().ilike('email', like(email)).order('created_at', 'asc').limit(1));
  return r.ok ? { ok: true, row: r.value } : { ok: false };
}

export interface CodeRow { email: string; code_hash: string; tries: number; sent_at: string; expires_at: string }
