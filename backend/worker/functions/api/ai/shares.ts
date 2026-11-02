/**
 * VinaX AI — the signed-in listener's shared chat links.
 *
 *   GET  /api/ai/shares[?conversation=<uuid>] → 200 { items: [{ id, conversationId, title, messageCount, createdAt, updatedAt }] }
 *   POST /api/ai/shares { conversationId } → 201 { share } a new link · 200 { share } the same link, snapshot taken again
 *   → 400 bad_request · 401 signed_out · 404 not_found (missing, deleted or someone else's chat)
 *   → 413 too_large · 422 empty · 429 rate_limited · 503 unavailable
 *
 * The snapshot is the chat's active branch as it is now (_lib/ai/shares.ts).
 * Messages added later are not in it until the owner updates the link.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { getConversation, isUuid, listMessages } from '../../_lib/ai/store';
import {
  byteSize, listShares, MAX_SHARE_BYTES, newShareId, publicShareSummary, shareOfConversation, shareTitle, snapshotOf, type ShareRow,
} from '../../_lib/ai/shares';
import type { AiEnv } from '../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-shares', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const conv = new URL(request.url).searchParams.get('conversation');
  if (conv && !isUuid(conv)) return json({ items: [] });
  const r = await listShares(env, sub, conv);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ items: r.rows.map(publicShareSummary) });
};

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-share-write', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<{ conversationId?: unknown } | null>(request, 1_024);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const id = read.value.conversationId;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);

  const c = await getConversation(env, sub, id);
  if (!c.ok) return json({ error: 'unavailable' }, 503);
  if (!c.value) return json({ error: 'not_found' }, 404);
  const m = await listMessages(env, c.value.id);
  if (!m.ok) return json({ error: 'unavailable' }, 503);
  const messages = snapshotOf(c.value, m.rows);
  if (!messages.length) return json({ error: 'empty' }, 422);
  const bytes = byteSize(messages);
  if (bytes > MAX_SHARE_BYTES) return json({ error: 'too_large' }, 413);

  const now = new Date().toISOString();
  const snapshot = { title: shareTitle(c.value.title), messages, message_count: messages.length, bytes, updated_at: now };
  const update = async (shareId: string): Promise<Response> => {
    const r = await db.update<ShareRow>(env, 'ai_shares', q().eq('id', shareId).eq('account_id', sub), snapshot, { returning: true });
    if (!r.ok || !r.rows[0]) return json({ error: 'unavailable' }, 503);
    return json({ share: publicShareSummary(r.rows[0]) });
  };

  const have = await shareOfConversation(env, sub, c.value.id);
  if (!have.ok) return json({ error: 'unavailable' }, 503);
  if (have.value) return update(have.value.id);
  const made = await db.insert<ShareRow>(env, 'ai_shares', { id: newShareId(), account_id: sub, conversation_id: c.value.id, created_at: now, ...snapshot }, { returning: true });
  if (made.ok && made.rows[0]) return json({ share: publicShareSummary(made.rows[0]) }, 201);
  // Two taps at once: the other request made the link, so update that one.
  if (!made.ok && made.error === 'conflict') {
    const again = await shareOfConversation(env, sub, c.value.id);
    if (again.ok && again.value) return update(again.value.id);
  }
  return json({ error: 'unavailable' }, 503);
};
