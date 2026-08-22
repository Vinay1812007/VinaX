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
