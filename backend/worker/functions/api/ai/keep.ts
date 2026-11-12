/**
 * VinaX AI — POST /api/ai/keep: save the part of a reply the page saw when
 * the reply did not end on its own (Stop, or a stream that broke off).
 *
 *   Authorization: Bearer <session>
 *   { conversationId, userMessageId, assistantMessageId,   // from the reply's meta event
 *     text, thinking?, model?: "<registry id>", stopReason: "aborted" | "error" }
 *   → 200 { ok: true, saved: boolean }   (saved false: the reply was already saved, or there was no text)
 *   → 400 bad_request · 401 signed_out · 404 not_found · 413 too_long · 429 rate_limited · 503 unavailable
 *
 * The chat streams the provider's bytes straight to the page (passthrough.ts),
 * so a reply cut short is only whole on the page. It is the listener's own
 * chat: the text is stored as the reply to their question, never anyone
 * else's. A reply the chat already saved is left as it is.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { MODELS, modelById } from '../../_lib/ai/models';
import { artifactsOf } from '../../_lib/ai/artifacts';
import { THINK_MAX } from '../../_lib/ai/think';
import { getConversation, insertMessage, isUuid, listMessages, updateConversation } from '../../_lib/ai/store';
import { MAX_TEXT_CHARS, onRequestOptions as chatOptions } from './chat';
import type { AiEnv } from '../../_lib/ai/types';

interface Ctx {
  request: Request;
  env: AiEnv;
}

export const onRequestOptions = chatOptions;

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-keep', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_TEXT_CHARS * 4 + 100_000);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_long' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const b = read.value && typeof read.value === 'object' ? read.value : {};
  const { conversationId, userMessageId, assistantMessageId } = b;
  if (!isUuid(conversationId) || !isUuid(userMessageId) || !isUuid(assistantMessageId)) return json({ error: 'bad_request' }, 400);
  if (typeof b.text !== 'string') return json({ error: 'bad_request' }, 400);
  if (b.text.length > MAX_TEXT_CHARS) return json({ error: 'too_long' }, 413);
  const text = b.text;
  const thinking = typeof b.thinking === 'string' && b.thinking ? b.thinking.slice(0, THINK_MAX) : null;
  const stopReason = b.stopReason === 'error' ? 'error' : 'aborted';
  const spec = modelById(MODELS, b.model);

  const conv = await getConversation(env, sub, conversationId);
  if (!conv.ok) return json({ error: 'unavailable' }, 503);
  if (!conv.value) return json({ error: 'not_found' }, 404);
  const rows = await listMessages(env, conversationId);
  if (!rows.ok) return json({ error: 'unavailable' }, 503);
  if (!rows.rows.some((r) => r.id === userMessageId && r.role === 'user')) return json({ error: 'not_found' }, 404);
  // Already saved (the reply ended on the server after all), or nothing to keep.
  if (rows.rows.some((r) => r.id === assistantMessageId) || !text.trim()) return json({ ok: true, saved: false });

  const found = artifactsOf(text);
  const saved = await insertMessage(env, {
    id: assistantMessageId, conversation_id: conversationId, parent_id: userMessageId, role: 'assistant',
    content: [{ type: 'text', text }], thinking, thinking_ms: null, sources: null,
    artifacts: found.length ? found : null,
    model_id: spec?.id ?? null, provider: spec?.provider ?? null, stop_reason: stopReason, usage: null,
  });
  // 23505: the chat saved it a moment ago.
  if (!saved.ok) return saved.code === '23505' ? json({ ok: true, saved: false }) : json({ error: 'unavailable' }, 503);
  await updateConversation(env, sub, conversationId, { updated_at: new Date().toISOString(), active_leaf_id: assistantMessageId });
  return json({ ok: true, saved: true });
};
