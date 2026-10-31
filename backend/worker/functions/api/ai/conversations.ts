/**
 * VinaX AI — GET /api/ai/conversations?cursor=&q=: the signed-in listener's
 * conversations, newest first.
 *
 *   → 200 { items: [{ id, title, starred, modelPref, activeLeafId, createdAt, updatedAt }], nextCursor }
 *     `cursor` is the previous page's nextCursor; `q` searches titles and message text.
 *   → 401 signed_out · 503 unavailable
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { listConversations, publicConversation } from '../../_lib/ai/store';
import type { AiEnv } from '../../_lib/ai/types';

export const PAGE_SIZE = 30;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-conversations', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const before = cursor && !Number.isNaN(Date.parse(cursor)) ? new Date(cursor).toISOString() : null;
  const r = await listConversations(env, sub, { before, query: url.searchParams.get('q'), limit: PAGE_SIZE });
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  const items = r.rows.map(publicConversation);
  const last = r.rows[r.rows.length - 1];
  return json({ items, nextCursor: r.rows.length === PAGE_SIZE && last ? last.updated_at : null });
};
