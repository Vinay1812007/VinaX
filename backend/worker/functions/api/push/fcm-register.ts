/**
 * POST /api/push/fcm-register { token, lang?, platform?, tzOffset? }
 *   → 200 { ok: true } | 400 bad_request | 503 not_configured
 *
 * Keeps an Android (Firebase Cloud Messaging) device token as a
 * `push_devices` row (channel `fcm`) so background push reaches a closed app.
 * The app re-registers on every open, which refreshes the row.
 */
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { asObject, clip, edgeGeo, jsonResponse, platformOf } from '../../_lib/edge';
import { rateLimit } from '../../_lib/ratelimit';
import { cleanTzOffset } from './subscribe';

/** A build that bundles the assets runs on https://localhost and needs the preflight answered. */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (context: { request: Request; env: DbEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-fcm', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) return jsonResponse({ error: 'bad_request' }, 400, CORS);
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const geo = edgeGeo(request);
  const platform = platformOf(body?.platform, request);
  const r = await db.upsert(env, 'push_devices', {
    channel: 'fcm',
    target: token,
    platform: platform === 'web' ? 'android' : platform,
    lang: clip(body?.lang, 8)?.toLowerCase() ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    tz_offset: cleanTzOffset(body?.tzOffset),
    active: true,
    updated_at: new Date().toISOString(),
  }, 'target');
  return r.ok ? jsonResponse({ ok: true }, 200, CORS) : jsonResponse({ error: 'unavailable' }, 503, CORS);
};
