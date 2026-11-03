/**
 * POST /api/push/opened { id } → 204
 *
 * Console rebuild — someone tapped a notification. The service worker (web) and
 * the Android tap handler send the notification's id; the count feeds the
 * "opened" and "open rate" columns on Send Notification → History. No
 * identity is sent or stored, only +1 on that notification. Ids are not
 * secret, so the count is a guide: rate-limited per address.
 */
import { db, dbConfigured, type DbEnv } from '../../_lib/db';
import { asObject } from '../../_lib/edge';
import { rateLimit } from '../../_lib/ratelimit';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestPost = async (context: { request: Request; env: DbEnv }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-opened', { capacity: 20, refillPerMinute: 20 }, env);
  if (limited) return limited;
  const body = asObject(await request.json().catch(() => null));
  const raw = body?.id;
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0) return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: { 'content-type': 'application/json', ...CORS } });
  if (dbConfigured(env)) await db.rpc(env, 'notification_opened', { p_id: id });
  return new Response(null, { status: 204, headers: CORS });
};
