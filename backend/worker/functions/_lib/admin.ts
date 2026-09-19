/** Shared admin-token gate for the /api/admin/* dashboards. */
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
 * consume budget, so a legitimate operator is unaffected. Per-isolate memory
 * (same trade-off as _lib/ratelimit.ts); MAX_ENTRIES caps flood growth.
 */
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 15;
const MAX_ENTRIES = 5_000;
const authFails = new Map<string, number[]>();

function sourceKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function isAdmin(request: Request, env: AdminEnv): boolean {
  if (!env.ADMIN_LOGIN_PASSWORD) return false;
  const header = request.headers.get('x-admin-token') ?? '';
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = header || bearer;
  if (!token) return false;

  const ipKey = sourceKey(request);
  const now = Date.now();
  const recent = (authFails.get(ipKey) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    authFails.set(ipKey, recent);
    return false; // locked out — do not even compare
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
  return ok;
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
