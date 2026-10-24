/**
 * POST /api/push/unsubscribe { endpoint } → 200 { ok } | 400 bad_request | 403 forbidden
 *
 * Switches a browser push subscription off (`push_devices.active = false`).
 * Same-origin only: a browser always sends Origin on a POST, and a third-party
 * page must not be able to silence a listener whose endpoint URL it learned.
 */
import { db, dbConfigured, q, type DbEnv } from '../../_lib/db';
import { asObject, clip, jsonResponse } from '../../_lib/edge';
import { rateLimit } from '../../_lib/ratelimit';

export const onRequestPost = async (context: { request: Request; env: DbEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-unsubscribe', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const endpoint = clip(body?.endpoint, 2048);
  if (!endpoint) return jsonResponse({ error: 'bad_request' }, 400);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return jsonResponse({ error: 'forbidden', message: 'same-origin required' }, 403);
  // Without a database nothing was ever kept, so there is nothing to switch off.
  if (!dbConfigured(env)) return jsonResponse({ ok: true });
  const r = await db.update(env, 'push_devices', q().eq('target', endpoint).eq('channel', 'web'), { active: false, updated_at: new Date().toISOString() });
  return jsonResponse({ ok: r.ok });
};
