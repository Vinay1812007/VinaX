/**
 * 15.0 — GET /api/share-chat/<id> — a shared conversation, read-only.
 *   → 200 { id, title, messages, model, createdAt, expiresAt }
 *   → 404 not_found (unknown, or past its expiry)   · 503 unavailable
 * Public by link; cached a minute at the edge.
 */
import { CORS, json } from '../../_lib/authShared';
import { rateLimit } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import type { SocialEnv } from '../../_lib/social';
import type { SharedChatRow } from '../share-chat';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv; params?: Record<string, unknown> }): Promise<Response> => {
  const limited = rateLimit(ctx.request, 'share-chat-read', { capacity: 60, refillPerMinute: 60 }, ctx.env);
  if (limited) return limited;
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = typeof ctx.params?.id === 'string' && /^[a-z0-9]{12}$/.test(ctx.params.id) ? ctx.params.id : null;
  if (!id) return json({ error: 'not_found' }, 404);
  const r = await db.one<SharedChatRow>(ctx.env, 'shared_chats', q().eq('id', id));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  const c = r.value;
  if (!c || Date.parse(c.expires_at) < Date.now()) return json({ error: 'not_found' }, 404);
  return json({ id: c.id, title: c.title, messages: c.payload.messages, model: c.payload.model ?? null, createdAt: c.created_at, expiresAt: c.expires_at });
};
