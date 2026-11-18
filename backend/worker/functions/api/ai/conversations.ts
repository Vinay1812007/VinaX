/**
 * VinaX AI — GET /api/ai/conversations?cursor=&q=&project=: the signed-in
 * listener's conversations, newest first.
 *
 *   → 200 { items: [{ id, title, starred, modelPref, activeLeafId, projectId, createdAt, updatedAt }], nextCursor }
 *     `cursor` is the previous page's nextCursor; `q` searches titles and message text;
 *     `project` keeps only the chats of that project (uuid).
 *   → 400 bad_request (project) · 401 signed_out · 503 unavailable
 *
 * DELETE /api/ai/conversations { ids: [uuid, …] } | { all: true }: delete several chats at once
 * (the Chats page's selection, or Settings → Delete all chats), the way one chat is deleted:
 * hidden now, purged a day later, their shared links gone now.
 *   → 200 { ok: true, deleted }  · 400 bad_request · 401 signed_out · 503 unavailable
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { isUuid, listConversations, publicConversation, type ConversationRow } from '../../_lib/ai/store';
import type { AiEnv } from '../../_lib/ai/types';

export const PAGE_SIZE = 30;
/** How many chats one DELETE may name. */
export const DELETE_MAX_IDS = 100;
/** How many chats "delete all" removes in one request (the page asks again while more remain). */
export const DELETE_ALL_BATCH = 500;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, DELETE, OPTIONS' } });

export const onRequestDelete = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-conversation-write', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<{ ids?: unknown; all?: unknown } | null>(request, 8_192);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const body = read.value;
  let ids: string[];
  if (body.all === true) {
    const r = await db.select<Pick<ConversationRow, 'id'>>(env, 'ai_conversations', q().eq('account_id', sub).is('deleted_at', 'null').select('id').order('updated_at', 'desc').limit(DELETE_ALL_BATCH));
    if (!r.ok) return json({ error: 'unavailable' }, 503);
    ids = r.rows.map((row) => row.id);
  } else {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > DELETE_MAX_IDS || !body.ids.every(isUuid)) return json({ error: 'bad_request' }, 400);
    ids = [...new Set(body.ids as string[])];
  }
  if (!ids.length) return json({ ok: true, deleted: 0 });
  // Only the account's own, live chats match; a stranger's id in the list changes nothing.
  const gone = await db.update<Pick<ConversationRow, 'id'>>(env, 'ai_conversations', q().eq('account_id', sub).in('id', ids).is('deleted_at', 'null').select('id'), { deleted_at: new Date().toISOString() }, { returning: true });
  if (!gone.ok) return json({ error: 'unavailable' }, 503);
  const deleted = gone.rows.map((row) => row.id);
  // Their shared links go too (not fatal: a link to a deleted chat already reads as not found).
  if (deleted.length) await db.remove(env, 'ai_shares', q().eq('account_id', sub).in('conversation_id', deleted));
  return json({ ok: true, deleted: deleted.length });
};

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
  const project = url.searchParams.get('project');
  if (project && !isUuid(project)) return json({ error: 'bad_request' }, 400);
  const r = await listConversations(env, sub, { before, query: url.searchParams.get('q'), projectId: project, limit: PAGE_SIZE });
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  const items = r.rows.map(publicConversation);
  const last = r.rows[r.rows.length - 1];
  return json({ items, nextCursor: r.rows.length === PAGE_SIZE && last ? last.updated_at : null });
};
