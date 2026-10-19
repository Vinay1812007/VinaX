/**
 * 12.2 — what the three /api/auth routes share: the CORS answer (the Android
 * shell may run on its own origin), JSON replies, and the account row.
 */
import { sbSelectRes, type SupabaseEnv } from './supabase';

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-vinax-device, x-vinax-platform, x-vinax-version',
};

/** 13.6.4 — the device's signed id, sent on GET /api/auth/me to link the device. */
export const DEVICE_HEADER = 'x-vinax-device';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

export interface AccountRow {
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  username: string | null;
  /** The last device linked to the account (vinax_users.device_id). */
  device_id?: string | null;
  last_seen?: string | null;
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
  const r = await sbSelectRes<AccountRow>(env, 'vinax_accounts', `google_sub=eq.${encodeURIComponent(sub)}&select=google_sub,email,name,picture,username,device_id,last_seen&limit=1`);
  if (!r.ok) return undefined;
  return r.rows[0] ?? null;
}

/** 13.7 — the app's platform and build, sent on sign-in and the session check. */
export const PLATFORM_HEADER = 'x-vinax-platform';
export const VERSION_HEADER = 'x-vinax-version';
const PLATFORMS = new Set(['web', 'android', 'ios', 'desktop', 'tv']);
const VERSION = /^[\w.+-]{1,24}$/;

/**
 * 13.7 — the coarse facts stored on an account row for the owner console:
 * Cloudflare's edge geo for this request (country, region, city — never the
 * IP) and the app's own platform and build. Platform and version are kept
 * only when they are well-formed; geo is always written (null when unknown),
 * so a listener who moves is shown where they signed in last.
 */
export function accountFacts(request: Request, body?: { platform?: unknown; appVersion?: unknown }): Record<string, string | null> {
  const cf = ((request as Request & { cf?: { country?: string; city?: string; region?: string } }).cf ?? {});
  const ipCountry = request.headers.get('cf-ipcountry');
  const country = (ipCountry && ipCountry !== 'XX' && ipCountry !== 'T1' ? ipCountry : cf.country) ?? null;
  const out: Record<string, string | null> = { country, region: cf.region ?? null, city: cf.city ?? null };
  const platform = String(body?.platform ?? request.headers.get(PLATFORM_HEADER) ?? '').trim().toLowerCase();
  if (PLATFORMS.has(platform)) out.platform = platform;
  const version = String(body?.appVersion ?? request.headers.get(VERSION_HEADER) ?? '').trim();
  if (VERSION.test(version)) out.app_version = version;
  return out;
}
