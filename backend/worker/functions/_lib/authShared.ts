/**
 * 12.2 — what the three /api/auth routes share: the CORS answer (the Android
 * shell may run on its own origin), JSON replies, and the account row.
 */
import { sbSelectRes, type SupabaseEnv } from './supabase';

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

export interface AccountRow {
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  username: string | null;
}

/** What the app is told about the signed-in listener. */
export const publicUser = (r: Pick<AccountRow, 'email' | 'name' | 'picture' | 'username'>) => ({
  name: r.name,
  email: r.email,
  picture: r.picture,
  username: r.username,
});

/** The account row; null = none; undefined = the store could not be read. */
export async function accountOf(env: SupabaseEnv, sub: string): Promise<AccountRow | null | undefined> {
  const r = await sbSelectRes<AccountRow>(env, 'vinax_accounts', `google_sub=eq.${encodeURIComponent(sub)}&select=google_sub,email,name,picture,username&limit=1`);
  if (!r.ok) return undefined;
  return r.rows[0] ?? null;
}
