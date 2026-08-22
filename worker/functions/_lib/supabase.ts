/**
 * Minimal Supabase REST helper for Cloudflare Pages Functions.
 * Uses the SERVICE-ROLE key (server-side only) so it bypasses RLS. The key is
 * read from env and never sent to any client.
 */
export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

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

export async function sbInsert(env: SupabaseEnv, table: string, row: unknown): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}`, {
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
    const res = await fetch(`${b.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
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
    const res = await fetch(`${b.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
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
): Promise<{ ok: boolean; rows: T[] }> {
  const b = base(env);
  if (!b) return { ok: false, rows: [] };
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key) });
    if (!res.ok) return { ok: false, rows: [] };
    return { ok: true, rows: (await res.json().catch(() => [])) as T[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

export async function sbSelect<T>(env: SupabaseEnv, table: string, query: string): Promise<T[]> {
  const b = base(env);
  if (!b) return [];
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, { headers: headers(b.key) });
    if (!res.ok) return [];
    return (await res.json().catch(() => [])) as T[];
  } catch {
    return [];
  }
}

/**
 * Exact row count via a HEAD request (Prefer: count=exact) — no rows move.
 * Returns null when Supabase is unconfigured or the read fails (missing
 * table, transport error), so callers can distinguish "0 rows" from "broken".
 */
export async function sbCount(env: SupabaseEnv, table: string, query = ''): Promise<number | null> {
  const b = base(env);
  if (!b) return null;
  try {
    // limit=1 keeps the scan cheap; NO Range header — an explicit `range: 0-0`
    // can answer 416 on an empty table (PostgREST version dependent), which
    // made a legitimate zero look like a failure (4.15.0 "corpus":null bug).
    // GET, not HEAD (4.16.2): in production the unfiltered HEAD count came
    // back without a usable content-range while filtered ones worked — GET
    // always carries the header and a limit=1 body costs nothing.
    const res = await fetch(`${b.url}/rest/v1/${table}?select=*&limit=1${query ? `&${query}` : ''}`, {
      headers: headers(b.key, { prefer: 'count=exact' }),
    });
    if (!res.ok) return null;
    const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/** Call a Postgres function exposed via PostgREST (/rpc/<fn>). */
export async function sbRpc<T>(env: SupabaseEnv, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const b = base(env);
  if (!b) return null;
  try {
    const res = await fetch(`${b.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: headers(b.key),
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

export async function sbDelete(env: SupabaseEnv, table: string, query: string): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, {
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
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, {
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
    const res = await fetch(`${b.url}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: headers(b.key, { prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}
