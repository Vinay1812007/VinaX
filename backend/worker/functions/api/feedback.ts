/**
 * POST /api/feedback { type, message, name?, deviceId?, appVersion?, platform? }
 *   → 200 { ok: true }          stored
 *   → 400 message_required      empty message
 *   → 503 not_configured        no database on this Worker
 *
 * Listeners send this on purpose, so it is not consent-gated. Coarse edge geo
 * is added; no IP is kept. The owner reads it on the console's Feedback page.
 */
import { db, dbConfigured, type DbEnv } from '../_lib/db';
import { appVersionOf, asObject, clip, edgeGeo, jsonResponse, platformOf } from '../_lib/edge';
import { resolveIdentity, type IdentityEnv } from '../_lib/identity';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';

type Env = DbEnv & IdentityEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const KINDS: ReadonlySet<string> = new Set(['bug', 'idea', 'content', 'other']);

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

/** POST-only: GET is an honest 405, not the app shell. */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = await rateLimitAsync(request, 'feedback', { capacity: 5, refillPerMinute: 2 }, env);
  if (limited) return limited;
  if (!dbConfigured(env)) return jsonResponse({ error: 'not_configured' }, 503, CORS);

  const body = asObject(await request.json().catch(() => null)) ?? {};
  const message = clip(body.message, 2000);
  if (!message) return jsonResponse({ error: 'message_required' }, 400, CORS);
  const kindRaw = clip(body.type, 16)?.toLowerCase() ?? 'other';
  const geo = edgeGeo(request);
  // The device behind the message, when the app named itself (so the owner can
  // open the listener from the inbox). An unsigned claim still yields the same
  // derived id the events route uses, never the raw install id.
  const identity = typeof body.deviceId === 'string' || typeof body.signed_device_id === 'string' ? await resolveIdentity(env, body) : null;

  const r = await db.insert(env, 'feedback', {
    listener_id: identity?.id ?? null,
    name: clip(body.name, 80),
    kind: KINDS.has(kindRaw) ? kindRaw : 'other',
    message,
    platform: platformOf(body.platform, request),
    app_version: appVersionOf(body.appVersion, request),
    country: geo.country,
    city: geo.city,
  });
  if (!r.ok) return jsonResponse({ error: 'unavailable' }, 503, CORS);
  return jsonResponse({ ok: true }, 200, CORS);
};
