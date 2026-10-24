/**
 * What the /api/auth and /api/account routes share: the CORS answer (the
 * Android shell may run on its own origin), JSON replies, the `accounts` row
 * and what the app is told about the signed-in listener.
 */
import { db, q, type DbEnv, type Value } from './db';
import { appVersionOf, edgeGeo, platformOf } from './edge';

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-vinax-device, x-vinax-platform, x-vinax-version',
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

/** One `accounts` row. */
export interface AccountRow {
  id: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
  listener_id: string | null;
  platform: string | null;
  app_version: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  created_at: string;
  last_seen: string;
}

/** The account row for a Google subject: null when none, a failure when the read broke. */
export function accountOf(env: DbEnv, sub: string): Promise<Value<AccountRow | null>> {
  return db.one<AccountRow>(env, 'accounts', q().eq('id', sub));
}

/** The handle on a linked device row, or null. */
export async function handleOf(env: DbEnv, listenerId: string | null): Promise<string | null> {
  if (!listenerId) return null;
  const r = await db.one<{ handle: string | null }>(env, 'listeners', q().eq('id', listenerId).select('handle'));
  return r.ok ? r.value?.handle ?? null : null;
}

/**
 * The coarse sign-in facts every account row carries: the edge's geo (never
 * the IP), the platform and the app build (body fields or the app headers).
 */
export function accountFacts(request: Request, body: Record<string, unknown> = {}): Pick<AccountRow, 'platform' | 'app_version' | 'country' | 'region' | 'city'> {
  const geo = edgeGeo(request);
  return { platform: platformOf(body.platform, request), app_version: appVersionOf(body.appVersion, request), country: geo.country, region: geo.region, city: geo.city };
}

/** What the app is told about the signed-in listener. */
export const publicUser = (r: { email: string | null; name: string | null; picture: string | null }, username: string | null) => ({
  name: r.name,
  email: r.email,
  picture: r.picture,
  username,
});
