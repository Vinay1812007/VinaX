/**
 * Minimal Supabase REST helper for the Worker.
 * Uses the SERVICE-ROLE key (server-side only) so it bypasses RLS. The key is
 * read from env and never sent to any client.
 *
 * 7.2.0 — every request carries a deadline (DB_TIMEOUT_MS unless the caller
 * passes its own), so a hung database can no longer hold a route open until
 * the platform kills it. Reads that must tell "empty" from "broken" use
 * `sbSelectResult`, which names the failure; `sbSelect` stays the
 * best-effort read for callers that deliberately treat a failure as "no rows".
 */
export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Default deadline for one database request. */
export const DB_TIMEOUT_MS = 8_000;

function base(env: SupabaseEnv): { url: string; key: string } | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.SUPABASE_URL.replace(/\/+$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY };
}

export function supabaseConfigured(env: SupabaseEnv): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(key: string, extra?: Record<string, string>): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra };
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * fetch with a deadline covering the WHOLE exchange: the response body is
 * buffered under the same timer, so a stalled stream is cut as surely as a
 * stalled connect. Rejects (AbortError) once `ms` passes.
 */
export async function dbFetch(url: string, init: RequestInit = {}, ms = DB_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = NULL_BODY_STATUS.has(res.status) ? null : await res.arrayBuffer();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why a read did not produce rows:
 *   not_configured — no database env on this Worker;
 *   unauthorized   — the database refused the service key (401/403);
 *   bad_request    — the query itself was refused (400: bad filter / column);
 *   not_found      — the table or function does not exist (404: a migration is missing);
 *   unavailable    — 5xx, network failure, unparseable body or the deadline passed.
 */
export type DbFailure = 'not_configured' | 'unauthorized' | 'bad_request' | 'not_found' | 'unavailable';

export type DbResult<T> = { ok: true; rows: T[] } | { ok: false; error: DbFailure; httpStatus: number | null; rows: T[] };

/** A single value (an RPC answer, a count) that says exactly why it failed. */
export type DbValue<T> = { ok: true; value: T } | { ok: false; error: DbFailure; httpStatus: number | null };

export function dbFailureFromStatus(status: number): DbFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'unavailable';
}

/** The JSON error code an admin route answers with for a failed read. */
export function dbErrorCode(error: DbFailure): string {
  return error === 'not_configured' ? 'db_not_configured' : error === 'unauthorized' ? 'db_unauthorized' : error === 'not_found' ? 'db_schema_missing' : error === 'bad_request' ? 'db_bad_request' : 'db_unavailable';
}

/** SELECT that says exactly why it failed. `rows` is always an array (empty on failure). */
export async function sbSelectResult<T>(env: SupabaseEnv, table: string, query: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<DbResult<T>> {
  const b = base(env);
  if (!b) return { ok: false, error: 'not_configured', httpStatus: null, rows: [] };
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key, opts.headers) }, opts.timeoutMs);
    if (!res.ok) return { ok: false, error: dbFailureFromStatus(res.status), httpStatus: res.status, rows: [] };
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return { ok: false, error: 'unavailable', httpStatus: res.status, rows: [] };
    return { ok: true, rows: body as T[] };
  } catch {
    return { ok: false, error: 'unavailable', httpStatus: null, rows: [] };
  }
}

export async function sbInsert(env: SupabaseEnv, table: string, row: unknown): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers(b.key, { prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * INSERT with `Prefer: resolution=ignore-duplicates` — on conflict the row is
 * skipped and the response array comes back EMPTY. The caller can detect that
 * empty representation as a collision and retry with fresh keys (see the room
 * create path in api/room.ts, audit finding H-SRV-4). Returns the parsed rows
 * (length 0 = conflict, length >= 1 = success), or null on transport failure.
 */
export async function sbInsertIgnore<T>(
  env: SupabaseEnv,
  table: string,
  row: unknown,
  onConflict: string,
): Promise<T[] | null> {
  const b = base(env);
  if (!b) return null;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: headers(b.key, { prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => [])) as T[];
  } catch {
    return null;
  }
}

export async function sbUpsert(env: SupabaseEnv, table: string, row: unknown, onConflict: string): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: headers(b.key, { prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * SELECT that distinguishes "no rows" from "the read FAILED" (table missing,
 * transport error, bad filter). sbSelect's swallow-everything contract made
 * a missing table indistinguishable from an empty one — admin/experiments
 * reported `configured: true` over a table that doesn't exist (audit D-1).
 */
export async function sbSelectRes<T>(
  env: SupabaseEnv,
  table: string,
  query: string,
): Promise<{ ok: boolean; rows: T[]; error?: DbFailure }> {
  const r = await sbSelectResult<T>(env, table, query);
  return r.ok ? { ok: true, rows: r.rows } : { ok: false, rows: [], error: r.error };
}

/**
 * Best-effort SELECT: any failure reads as "no rows". Use it only where an
 * empty answer is an acceptable degradation (public pages, cron throttles).
 * Dashboards and anything that reports numbers use `sbSelectResult`.
 */
export async function sbSelect<T>(env: SupabaseEnv, table: string, query: string): Promise<T[]> {
  const b = base(env);
  if (!b) return [];
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key) });
    if (!res.ok) return [];
    return (await res.json().catch(() => [])) as T[];
  } catch {
    return [];
  }
}

/**
 * Exact row count that names its failure. GET with `Prefer: count=exact` and
 * limit=1 — no rows move. A response without a usable content-range is a
 * failure, never a zero.
 */
export async function sbCountResult(env: SupabaseEnv, table: string, query = '', opts: { timeoutMs?: number } = {}): Promise<DbValue<number>> {
  const b = base(env);
  if (!b) return { ok: false, error: 'not_configured', httpStatus: null };
  try {
    // limit=1 keeps the scan cheap; NO Range header — an explicit `range: 0-0`
    // can answer 416 on an empty table (PostgREST version dependent), which
    // made a legitimate zero look like a failure (4.15.0 "corpus":null bug).
    // GET, not HEAD (4.16.2): in production the unfiltered HEAD count came
    // back without a usable content-range while filtered ones worked — GET
    // always carries the header and a limit=1 body costs nothing.
    const res = await dbFetch(
      `${b.url}/rest/v1/${table}?select=*&limit=1${query ? `&${query}` : ''}`,
      { headers: headers(b.key, { prefer: 'count=exact' }) },
      opts.timeoutMs,
    );
    if (!res.ok) return { ok: false, error: dbFailureFromStatus(res.status), httpStatus: res.status };
    const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(total) ? { ok: true, value: total } : { ok: false, error: 'unavailable', httpStatus: res.status };
  } catch {
    return { ok: false, error: 'unavailable', httpStatus: null };
  }
}

/**
 * Exact row count via GET (Prefer: count=exact) — no rows move.
 * Returns null when Supabase is unconfigured or the read fails (missing
 * table, transport error), so callers can distinguish "0 rows" from "broken".
 */
export async function sbCount(env: SupabaseEnv, table: string, query = ''): Promise<number | null> {
  const r = await sbCountResult(env, table, query);
  return r.ok ? r.value : null;
}

/**
 * Call a Postgres function exposed via PostgREST (/rpc/<fn>) and say exactly
 * why it failed. A missing function answers 404 → `not_found`, which callers
 * with a sampled fallback treat as "migration not applied yet".
 */
export async function sbRpcResult<T>(env: SupabaseEnv, fn: string, args: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<DbValue<T>> {
  const b = base(env);
  if (!b) return { ok: false, error: 'not_configured', httpStatus: null };
  try {
    const res = await dbFetch(
      `${b.url}/rest/v1/rpc/${fn}`,
      { method: 'POST', headers: headers(b.key), body: JSON.stringify(args ?? {}) },
      opts.timeoutMs,
    );
    if (!res.ok) return { ok: false, error: dbFailureFromStatus(res.status), httpStatus: res.status };
    const text = await res.text();
    try {
      return { ok: true, value: (text ? JSON.parse(text) : null) as T };
    } catch {
      return { ok: false, error: 'unavailable', httpStatus: res.status };
    }
  } catch {
    return { ok: false, error: 'unavailable', httpStatus: null };
  }
}

/** Best-effort RPC: any failure reads as null. Dashboards use `sbRpcResult`. */
export async function sbRpc<T>(env: SupabaseEnv, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const r = await sbRpcResult<T>(env, fn, args);
  return r.ok ? r.value : null;
}

export async function sbDelete(env: SupabaseEnv, table: string, query: string): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: headers(b.key, { prefer: 'return=minimal' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * DELETE returning the removed rows so callers can distinguish 'nothing
 * matched' (0 rows) from 'deleted successfully' (>=1 rows). Prevents the
 * silent no-op that audit finding M-SRV-9 flagged in admin/notifylog.
 */
export async function sbDeleteReturning<T>(env: SupabaseEnv, table: string, query: string): Promise<T[] | null> {
  const b = base(env);
  if (!b) return null;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: headers(b.key, { prefer: 'return=representation' }),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => [])) as T[];
  } catch {
    return null;
  }
}

export async function sbUpdate(env: SupabaseEnv, table: string, query: string, patch: unknown): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await dbFetch(`${b.url}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: headers(b.key, { prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}
