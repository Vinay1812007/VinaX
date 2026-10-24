/**
 * POST /api/push/subscribe { endpoint, keys: { p256dh, auth }, lang?, tzOffset? }
 *   → 200 { ok: true }
 *   → 400 bad_request | endpoint_rejected
 *   → 503 not_configured          no database on this Worker
 *
 * Keeps a browser push subscription as a `push_devices` row (channel `web`),
 * with the language, the device's UTC offset (quiet hours) and the edge's
 * coarse geo so the owner can send to a city. Re-subscribing refreshes the
 * row and switches it back on.
 */
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { asObject, clip, edgeGeo, intIn, jsonResponse } from '../../_lib/edge';
import { rateLimit } from '../../_lib/ratelimit';

/**
 * Known Web Push service hosts. Anything else would let an attacker register
 * an arbitrary URL as their "endpoint" and turn later fan-outs into an
 * authenticated beacon from Cloudflare's edge. Per-region hosts are matched
 * by pattern, never by suffix alone.
 */
const ALLOWED_PUSH_HOSTS: Array<string | RegExp> = [
  'fcm.googleapis.com',
  /^updates(-\w+)?\.push\.services\.mozilla\.com$/,
  /^wns2-[a-z0-9-]+\.notify\.windows\.com$/,
  'web.push.apple.com',
  /^api\.push\.apple\.com$/,
];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.host.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((rule) => (typeof rule === 'string' ? host === rule : rule.test(host)));
}

/** Device UTC offset in minutes east, inside the real range, else null. */
export const cleanTzOffset = (v: unknown): number | null => intIn(v, -840, 840);

export const onRequestPost = async (context: { request: Request; env: DbEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-subscribe', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const keys = asObject(body?.keys);
  const endpoint = clip(body?.endpoint, 2048);
  const p256dh = clip(keys?.p256dh, 200);
  const auth = clip(keys?.auth, 100);
  if (!endpoint || !p256dh || !auth) return jsonResponse({ error: 'bad_request' }, 400);
  if (!isAllowedPushEndpoint(endpoint)) return jsonResponse({ error: 'endpoint_rejected' }, 400);
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503);
  const geo = edgeGeo(request);
  const r = await db.upsert(env, 'push_devices', {
    channel: 'web',
    target: endpoint,
    p256dh,
    auth,
    platform: 'web',
    lang: clip(body?.lang, 8)?.toLowerCase() ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    tz_offset: cleanTzOffset(body?.tzOffset),
    active: true,
    updated_at: new Date().toISOString(),
  }, 'target');
  return r.ok ? jsonResponse({ ok: true }) : jsonResponse({ error: 'unavailable' }, 503);
};
