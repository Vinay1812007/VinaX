/**
 * POST /api/push/fcm-register { token, lang?, platform?, tzOffset? }
 *   → 200 { ok: true } | 400 bad_request | 503 not_configured
 *
 * Keeps an Android (Firebase Cloud Messaging) device token as a
 * `push_devices` row (channel `fcm`) so background push reaches a closed app.
 * The app re-registers on every open, which refreshes the row.
 *
 * Console rebuild — `Authorization: Bearer vx1…` (the signed-in listener's session)
 * links the device to that Google account; without it the link is cleared.
 */
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { asObject, clip, edgeGeo, jsonResponse, platformOf } from '../../_lib/edge';
import { rateLimit } from '../../_lib/ratelimit';
import { accountOfRequest, cleanTzOffset } from './subscribe';
import type { AuthEnv } from '../../_lib/googleAuth';

/** A build that bundles the assets runs on https://localhost and needs the preflight answered. */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (context: { request: Request; env: DbEnv & AuthEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-fcm', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) return jsonResponse({ error: 'bad_request' }, 400, CORS);
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const geo = edgeGeo(request);
  const platform = platformOf(body?.platform, request);
  const accountId = await accountOfRequest(request, env);
  const row = {
    channel: 'fcm',
    target: token,
    platform: platform === 'web' ? 'android' : platform,
    lang: clip(body?.lang, 8)?.toLowerCase() ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    tz_offset: cleanTzOffset(body?.tzOffset),
    account_id: accountId,
    active: true,
    updated_at: new Date().toISOString(),
  };
  let r = await db.upsert(env, 'push_devices', row, 'target');
  // Never lose the device: a session for an account that no longer exists, or
  // a database still on schema 7 (no account_id column), saves it unlinked.
  if (!r.ok) {
    const { account_id: _linked, ...unlinked } = row;
    void _linked;
    r = await db.upsert(env, 'push_devices', unlinked, 'target');
  }
  return r.ok ? jsonResponse({ ok: true, linked: !!accountId }, 200, CORS) : jsonResponse({ error: 'unavailable' }, 503, CORS);
};
