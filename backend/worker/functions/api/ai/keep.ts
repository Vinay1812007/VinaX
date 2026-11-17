/**
 * VinaX AI — POST /api/ai/keep: save a reply as the page saw it, when the
 * chat could not: it did not end on its own (Stop, or a stream that broke
 * off), or it ended but was too large for the chat to read again
 * (`done.saved: false`, chat.ts PARSE_MAX_CHARS).
 *
 *   Authorization: Bearer <session>
 *   { conversationId, userMessageId, assistantMessageId,   // from the reply's meta event
 *     text, thinking?, model?: "<registry id>", stopReason: "aborted" | "error" | "end" | "length",
 *     continued?: true }   // a Continue: `text` is the whole reply, the saved one plus what followed
 *   → 200 { ok: true, saved: boolean }   (saved false: the reply was already saved, or there was no text)
 *
 * The page also sends this with keepalive when it closes mid-reply
 * (keepOnLeave.ts: text trimmed under 64 KB, stopReason "aborted") and
 * again from a draft on the device the next time it opens. So a part kept
 * that way is replaced by a fuller text that carries it on, or by the same
 * text with how it really ended; and the chat's own end-of-stream save
 * replaces it (chat.ts). A reply that ended is never cut down.
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
import { getConversation, insertMessage, isUuid, listMessages, replaceKeptPart, updateConversation, updateMessage } from '../../_lib/ai/store';
import { textOf } from '../../_lib/ai/history';
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
  const stopReason = b.stopReason === 'error' || b.stopReason === 'end' || b.stopReason === 'length' ? b.stopReason : 'aborted';
  const spec = modelById(MODELS, b.model);

  const conv = await getConversation(env, sub, conversationId);
  if (!conv.ok) return json({ error: 'unavailable' }, 503);
  if (!conv.value) return json({ error: 'not_found' }, 404);
  const rows = await listMessages(env, conversationId);
  if (!rows.ok) return json({ error: 'unavailable' }, 503);
  if (!rows.rows.some((r) => r.id === userMessageId && r.role === 'user')) return json({ error: 'not_found' }, 404);
  const found = artifactsOf(text);
  const existing = rows.rows.find((r) => r.id === assistantMessageId);
  if (b.continued === true) {
    // A Continue the chat could not save: the whole reply replaces the saved one, which it must start with.
    if (!existing || existing.role !== 'assistant' || existing.parent_id !== userMessageId) return json({ error: 'not_found' }, 404);
    const before = textOf(existing.content);
    if (text.length <= before.length || !text.startsWith(before)) return json({ ok: true, saved: false });
    const updated = await updateMessage(env, conversationId, assistantMessageId, {
      content: [{ type: 'text', text }],
      artifacts: found.length ? found : null,
      // The page's reasoning may already hold the saved part; never write it twice.
      thinking: (thinking && existing.thinking && thinking.startsWith(existing.thinking) ? thinking : [existing.thinking, thinking].filter(Boolean).join('\n\n')).slice(0, THINK_MAX) || null,
      ...(spec ? { model_id: spec.id, provider: spec.provider } : {}),
      stop_reason: stopReason,
    });
    if (!updated.ok) return json({ error: 'unavailable' }, 503);
    await updateConversation(env, sub, conversationId, { updated_at: new Date().toISOString(), active_leaf_id: assistantMessageId });
    return json({ ok: true, saved: true });
  }
  if (!text.trim()) return json({ ok: true, saved: false });
  if (existing) {
    // A part kept when the page went away: a fuller text (or the same one, now with how it ended) takes its place.
    const before = existing.role === 'assistant' && existing.parent_id === userMessageId && existing.stop_reason === 'aborted' ? textOf(existing.content) : null;
    const fuller = before !== null && text.startsWith(before) && (text.length > before.length || stopReason !== 'aborted');
    // Otherwise already saved (the reply ended on the server after all): left as it is.
    if (!fuller) return json({ ok: true, saved: false });
    const replaced = await replaceKeptPart(env, conversationId, assistantMessageId, {
      content: [{ type: 'text', text }],
      artifacts: found.length ? found : null,
      thinking: thinking ?? existing.thinking,
      ...(spec ? { model_id: spec.id, provider: spec.provider } : {}),
      stop_reason: stopReason,
    });
    if (!replaced.ok) return json({ error: 'unavailable' }, 503);
    // No row: the chat saved the whole reply a moment ago.
    if (!replaced.rows.length) return json({ ok: true, saved: false });
    await updateConversation(env, sub, conversationId, { updated_at: new Date().toISOString(), active_leaf_id: assistantMessageId });
    return json({ ok: true, saved: true });
  }

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
