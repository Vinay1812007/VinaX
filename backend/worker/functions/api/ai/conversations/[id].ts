/**
 * VinaX AI — one conversation of the signed-in listener.
 *
 *   GET    /api/ai/conversations/<id> → 200 { conversation, messages: [...] }  the whole tree
 *   PATCH  /api/ai/conversations/<id> { title?, starred?, activeLeafId? } → 200 { conversation }
 *   DELETE /api/ai/conversations/<id> → 200 { ok: true }   hidden now, purged a day later
 *   → 400 bad_request · 401 signed_out · 404 not_found (missing, deleted or someone else's) · 503 unavailable
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { dbConfigured } from '../../../_lib/db';
import { PROVIDER_NAMES } from '../../../_lib/ai/adapters';
import { MODELS, modelById } from '../../../_lib/ai/models';
import {
  deleteConversation, getConversation, isUuid, listMessages, publicConversation, publicMessage, updateConversation, type ConversationRow,
} from '../../../_lib/ai/store';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PATCH, DELETE, OPTIONS' } });

/** The session's account and its conversation, or the response to send instead. */
async function owned(ctx: Ctx, route: string): Promise<{ sub: string; conv: ConversationRow } | Response> {
  const limited = await rateLimitAsync(ctx.request, route, { capacity: 30, refillPerMinute: 30 }, ctx.env);
  if (limited) return limited;
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = ctx.params?.id;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const c = await getConversation(ctx.env, sub, id);
  if (!c.ok) return json({ error: 'unavailable' }, 503);
  if (!c.value) return json({ error: 'not_found' }, 404);
  return { sub, conv: c.value };
}

const label = (modelId: string): { name: string; provider: string } | null => {
  const spec = modelById(MODELS, modelId);
  return spec ? { name: spec.name, provider: PROVIDER_NAMES[spec.provider] } : null;
};

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-conversation');
  if (o instanceof Response) return o;
  const m = await listMessages(ctx.env, o.conv.id);
  if (!m.ok) return json({ error: 'unavailable' }, 503);
  return json({ conversation: publicConversation(o.conv), messages: m.rows.map((r) => publicMessage(r, label)) });
};

export const onRequestPatch = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-conversation-write');
  if (o instanceof Response) return o;
  const read = await readJsonCapped<Record<string, unknown> | null>(ctx.request, 4_096);
  if (!read.ok || !read.value || typeof read.value !== 'object') return json({ error: 'bad_request' }, 400);
  const b = read.value;
  const patch: Parameters<typeof updateConversation>[3] = {};
  if ('title' in b) {
    const t = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : '';
    if (!t || t.length > 120) return json({ error: 'bad_request' }, 400);
    patch.title = t;
  }
  if ('starred' in b) {
    if (typeof b.starred !== 'boolean') return json({ error: 'bad_request' }, 400);
    patch.starred = b.starred;
  }
  if ('activeLeafId' in b) {
    if (!isUuid(b.activeLeafId)) return json({ error: 'bad_request' }, 400);
    const m = await listMessages(ctx.env, o.conv.id);
    if (!m.ok) return json({ error: 'unavailable' }, 503);
    if (!m.rows.some((r) => r.id === b.activeLeafId)) return json({ error: 'not_found' }, 404);
    patch.active_leaf_id = b.activeLeafId;
  }
  if (!Object.keys(patch).length) return json({ error: 'bad_request' }, 400);
  // Starring or switching branches is not a new message: updated_at stays.
  if (patch.title) patch.updated_at = new Date().toISOString();
  const r = await updateConversation(ctx.env, o.sub, o.conv.id, patch);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.rows[0]) return json({ error: 'not_found' }, 404);
  return json({ conversation: publicConversation(r.rows[0]) });
};

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-conversation-write');
  if (o instanceof Response) return o;
  const r = await deleteConversation(ctx.env, o.sub, o.conv.id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ ok: true });
};
