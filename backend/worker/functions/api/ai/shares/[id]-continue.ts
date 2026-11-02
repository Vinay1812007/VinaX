/**
 * VinaX AI — POST /api/ai/shares/<id>/continue: a signed-in listener keeps
 * going from a shared chat. A NEW chat of their own is made from the
 * snapshot (the sharer's chat is never touched); files the snapshot names
 * stay out, so each is a "[file: name]" line.
 *
 *   → 200 { conversationId }
 *   → 401 signed_out · 404 not_found · 429 rate_limited · 503 ai_disabled | unavailable
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../../_lib/db';
import { aiOpenFor, aiSettings } from '../../../_lib/ai/config';
import { createConversation, updateConversation } from '../../../_lib/ai/store';
import { getShare, isShareId } from '../../../_lib/ai/shares';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

export const onRequestPost = async ({ request, env, params }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-share-continue', { capacity: 5, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  if (!aiOpenFor(await aiSettings(env), sub)) return json({ error: 'ai_disabled' }, 503);
  const id = params?.id;
  if (!isShareId(id)) return json({ error: 'not_found' }, 404);
  const s = await getShare(env, id);
  if (!s.ok) return json({ error: 'unavailable' }, 503);
  if (!s.value || !Array.isArray(s.value.messages) || !s.value.messages.length) return json({ error: 'not_found' }, 404);

  const made = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: s.value.title, model_pref: 'auto' });
  if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
  const conv = made.rows[0];
  if (!conv) return json({ error: 'unavailable' }, 503);

  // One insert: each message hangs on the one before.
  const base = Date.now();
  const rows = s.value.messages.map((m, i) => {
    const text = [m.text, ...(m.files ?? []).map((f) => `[file: ${f.name}]`)].filter(Boolean).join('\n\n');
    return {
      id: crypto.randomUUID(),
      conversation_id: conv.id,
      parent_id: null as string | null,
      role: m.role,
      content: [{ type: 'text', text }],
      sources: m.role === 'assistant' && m.sources ? m.sources : null,
      stop_reason: m.role === 'assistant' ? 'end' : null,
      created_at: new Date(base + i).toISOString(),
    };
  });
  rows.forEach((r, i) => { r.parent_id = i === 0 ? null : rows[i - 1].id; });
  const saved = await db.insert(env, 'ai_messages', rows, { returning: false });
  if (!saved.ok) {
    await db.remove(env, 'ai_conversations', q().eq('id', conv.id).eq('account_id', sub));
    return json({ error: 'unavailable' }, 503);
  }
  await updateConversation(env, sub, conv.id, { active_leaf_id: rows[rows.length - 1].id, updated_at: new Date().toISOString() });
  return json({ conversationId: conv.id });
};
