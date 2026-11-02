/**
 * VinaX AI — one shared chat.
 *
 *   GET    /api/ai/shares/<id> → 200 { share: { id, title, messages, createdAt, updatedAt } }
 *          Public: no session needed. The id is 128 random bits, so only
 *          people given the link can find it. Never indexed.
 *   DELETE /api/ai/shares/<id> → 200 { ok: true }  the owner stops sharing
 *   → 401 signed_out · 404 not_found · 429 rate_limited · 503 unavailable
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { dbConfigured } from '../../../_lib/db';
import { getShare, isShareId, removeShare } from '../../../_lib/ai/shares';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

const NOINDEX = { 'x-robots-tag': 'noindex, nofollow' };

const notFound = (): Response =>
  new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...NOINDEX, ...CORS } });

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, DELETE, OPTIONS' } });

export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-share-read', { capacity: 60, refillPerMinute: 60 }, env);
  if (limited) return limited;
  const id = params?.id;
  if (!isShareId(id)) return notFound();
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const r = await getShare(env, id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return notFound();
  const s = r.value;
  const body = { share: { id: s.id, title: s.title, messages: s.messages, createdAt: s.created_at, updatedAt: s.updated_at } };
  // Short: a link its owner stopped sharing goes dark within a minute.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...NOINDEX, ...CORS },
  });
};

export const onRequestDelete = async ({ request, env, params }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-share-write', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const id = params?.id;
  if (!isShareId(id)) return json({ error: 'not_found' }, 404);
  const r = await removeShare(env, sub, id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.rows.length) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
};
