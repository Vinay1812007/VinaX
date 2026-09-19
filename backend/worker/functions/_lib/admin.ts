/** Shared admin-token gate for the /api/admin/* dashboards. */
import { bindingAllows, clientKey } from './ratelimit';
import { safeEqual } from './safe-compare';
import { dbErrorCode, type DbFailure } from './supabase';

export interface AdminEnv {
  ADMIN_LOGIN_PASSWORD?: string;
}

/**
 * Failed-attempt throttle (admin audit: the single shared secret had
 * unlimited guess attempts across 30 endpoints, no lockout, no logging).
 * Sliding 10-minute window per source IP; after MAX_FAILS wrong tokens the
 * source is refused WITHOUT comparing — so a brute-forcer gets nothing even
 * if it eventually guesses right from the same address. Correct tokens never
 * consume budget, so a legitimate operator is unaffected. MAX_ENTRIES caps
 * flood growth.
 *
 * `isAdmin()` (sync) keeps this per-isolate memory only. `isAdminAsync()`
 * (7.2.0, every /api/admin route) also counts each WRONG token in the
 * ADMIN_AUTH_FAILS Rate Limiting binding, whose counter every isolate in a
 * Cloudflare location shares (15 per 60 s, wrangler.toml). The binding can
 * only be asked by counting, so it is consulted after a failed compare: once
 * it reports the location's budget spent, this isolate locks the source for
 * the full 10-minute window and refuses it without comparing. Other isolates
 * lock the same source on their next failed guess. Net effect per location:
 * about 15 wrong guesses a minute plus one per isolate before every isolate
 * that sees the source has locked it — instead of 15 per isolate. It is still
 * per location, not global, and the binding is eventually consistent.
 */
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 15;
const MAX_ENTRIES = 5_000;
const authFails = new Map<string, number[]>();
/** Sources the location-wide failure counter has locked, until the stored time. */
const lockedUntil = new Map<string, number>();

export interface AdminAuthEnv extends AdminEnv {
  /** Workers Rate Limiting binding counting wrong admin tokens (optional). */
  ADMIN_AUTH_FAILS?: unknown;
  TELEMETRY_PEPPER?: string;
}

function sourceKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function presentedToken(request: Request): string {
  const header = request.headers.get('x-admin-token') ?? '';
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return header || bearer;
}

/**
 * The per-isolate half shared by both variants: refuse a locked-out source
 * WITHOUT comparing, else compare in constant time and record a failure.
 * Returns the verdict and whether a wrong token was just recorded.
 */
function checkLocally(request: Request, env: AdminEnv, token: string): { ok: boolean; failed: boolean; ipKey: string } {
  const ipKey = sourceKey(request);
  const now = Date.now();
  const lockEnd = lockedUntil.get(ipKey);
  if (lockEnd !== undefined) {
    if (lockEnd > now) return { ok: false, failed: false, ipKey }; // locked location-wide — do not compare
    lockedUntil.delete(ipKey);
  }
  const recent = (authFails.get(ipKey) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    authFails.set(ipKey, recent);
    return { ok: false, failed: false, ipKey }; // locked out — do not even compare
  }

  // Constant-time compare so `===` short-circuit timing can't leak the secret
  // byte by byte over the network.
  const ok = safeEqual(token, env.ADMIN_LOGIN_PASSWORD);
  if (!ok) {
    recent.push(now);
    if (!authFails.has(ipKey) && authFails.size >= MAX_ENTRIES) authFails.clear();
    authFails.set(ipKey, recent);
  } else if (recent.length === 0) {
    authFails.delete(ipKey);
  }
  return { ok, failed: !ok, ipKey };
}

export function isAdmin(request: Request, env: AdminEnv): boolean {
  if (!env.ADMIN_LOGIN_PASSWORD) return false;
  const token = presentedToken(request);
  if (!token) return false;
  return checkLocally(request, env, token).ok;
}

/**
 * `isAdmin` plus the location-wide failure counter (see above). Correct
 * tokens never touch the binding, so the operator's own traffic costs no
 * budget; without the binding this is exactly `isAdmin`.
 */
export async function isAdminAsync(request: Request, env: AdminAuthEnv): Promise<boolean> {
  if (!env.ADMIN_LOGIN_PASSWORD) return false;
  const token = presentedToken(request);
  if (!token) return false;
  const verdict = checkLocally(request, env, token);
  if (verdict.failed) {
    const allowed = await bindingAllows(env, 'ADMIN_AUTH_FAILS', `admin-auth|${clientKey(request, env)}`);
    if (allowed === false) {
      if (!lockedUntil.has(verdict.ipKey) && lockedUntil.size >= MAX_ENTRIES) lockedUntil.clear();
      lockedUntil.set(verdict.ipKey, Date.now() + FAIL_WINDOW_MS);
    }
  }
  return verdict.ok;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** JSON answer for an admin route (never cached). */
export function adminJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** The failure half of a DbResult / DbValue. */
export interface ReadFailure {
  error: DbFailure;
  httpStatus: number | null;
}

/**
 * 7.2.0 — a required dashboard read failed: answer 502 with the failure's
 * kind, never a 200 with zeros or empty lists. The console treats any non-2xx
 * as "unavailable".
 */
export function dbFailure(fail: ReadFailure, extra: Record<string, unknown> = {}): Response {
  return adminJson({ configured: true, error: dbErrorCode(fail.error), upstreamStatus: fail.httpStatus, ...extra }, 502);
}

/** The first failed read among several, or null when every read succeeded. */
export function firstFailure(...reads: Array<{ ok: true } | ({ ok: false } & ReadFailure)>): ReadFailure | null {
  for (const r of reads) if (!r.ok) return { error: r.error, httpStatus: r.httpStatus };
  return null;
}
