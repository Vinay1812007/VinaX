/**
 * VinaX AI — POST /api/ai/feedback: thumbs up or down on one reply.
 *
 *   Authorization: Bearer <session>
 *   { conversationId, messageId,                // a saved reply in one of the listener's chats
 *     rating: "up" | "down" | null,             // null takes the rating back
 *     reason?: "wrong" | "not_helpful" | "too_slow" | "other",   // thumbs down only
 *     note?: "…" }                              // thumbs down only, at most 300 characters
 *   → 200 { ok: true, feedback: { rating, reason?, note? } | null }
 *   → 400 bad_request · 401 signed_out · 404 not_found · 429 rate_limited · 503 unavailable
 *
 * One rating per reply per account; sending again changes it. The model
 * and provider are the saved reply's own (_lib/ai/feedback.ts).
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { getConversation, isUuid, type MessageRow } from '../../_lib/ai/store';
import { clearFeedback, parseFeedback, publicFeedback, saveFeedback } from '../../_lib/ai/feedback';
import type { AiEnv } from '../../_lib/ai/types';

interface Ctx {
  request: Request;
  env: AiEnv;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-feedback', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 4_096);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const b = read.value;
  const { conversationId, messageId } = b;
  if (!isUuid(conversationId) || !isUuid(messageId)) return json({ error: 'bad_request' }, 400);
  const input = parseFeedback(b);
  if (!input) return json({ error: 'bad_request' }, 400);

  const conv = await getConversation(env, sub, conversationId);
  if (!conv.ok) return json({ error: 'unavailable' }, 503);
  if (!conv.value) return json({ error: 'not_found' }, 404);
  if (input.clear) {
    const r = await clearFeedback(env, sub, messageId);
    return r.ok ? json({ ok: true, feedback: null }) : json({ error: 'unavailable' }, 503);
  }
  const msg = await db.one<Pick<MessageRow, 'id' | 'role' | 'model_id' | 'provider'>>(env, 'ai_messages', q().select('id,role,model_id,provider').eq('id', messageId).eq('conversation_id', conversationId));
  if (!msg.ok) return json({ error: 'unavailable' }, 503);
  if (!msg.value || msg.value.role !== 'assistant') return json({ error: 'not_found' }, 404);
  const row = {
    message_id: messageId, conversation_id: conversationId, account_id: sub,
    model_id: msg.value.model_id ?? null, provider: msg.value.provider ?? null,
    rating: input.rating, reason: input.reason, note: input.note,
  };
  const saved = await saveFeedback(env, row);
  if (!saved.ok) return json({ error: 'unavailable' }, 503);
  console.log(JSON.stringify({ route: 'ai-feedback', model: row.model_id, rating: row.rating, reason: row.reason }));
  return json({ ok: true, feedback: publicFeedback(row) });
};
