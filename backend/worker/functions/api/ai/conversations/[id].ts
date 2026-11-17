/**
 * VinaX AI — one conversation of the signed-in listener.
 *
 *   GET    /api/ai/conversations/<id> → 200 { conversation, messages: [...] }  the whole tree
 *          (conversation.incognito: true for a chat that never uses memory; a reply the listener
 *          rated has feedback: { rating, reason?, note? }, POST /api/ai/feedback)
 *   PATCH  /api/ai/conversations/<id> { title?, starred?, activeLeafId?, projectId? } → 200 { conversation }
 *          projectId: a project of the account (move the chat into it) or null (out of its project)
 *   DELETE /api/ai/conversations/<id> → 200 { ok: true }   hidden now, purged a day later; its shared link goes now
 *   → 400 bad_request · 401 signed_out · 404 not_found (missing, deleted or someone else's) · 503 unavailable
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { PROVIDER_NAMES } from '../../../_lib/ai/adapters';
import { MODELS, modelById } from '../../../_lib/ai/models';
import { prettyName } from '../../../_lib/ai/modelName';
import { feedbackIn } from '../../../_lib/ai/feedback';
import {
  deleteConversation, getConversation, isUuid, listMessages, publicConversation, publicMessage, updateConversation, type ConversationRow,
} from '../../../_lib/ai/store';
import type { AiEnv, ProviderId } from '../../../_lib/ai/types';
import { liveLabel } from '../../../_lib/ai/voice';
import { removeSharesOf } from '../../../_lib/ai/shares';
import { getProject } from '../../../_lib/ai/projects';
import { db, dbConfigured, q } from '../../../_lib/db';
import { IMAGE_MODEL_ID, IMAGE_MODEL_LABEL } from '../../../_lib/ai/images';

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
  const live = liveLabel(modelId);
  if (live) return live;
  // A picture from Create image (POST /api/ai/images).
  if (modelId === IMAGE_MODEL_ID) return IMAGE_MODEL_LABEL;
  const spec = modelById(MODELS, modelId);
  if (spec) return { name: spec.name, provider: PROVIDER_NAMES[spec.provider] };
  // A model no longer in the registry (dropped, or found by the old model discovery): a name made from its id.
  const p = modelId.slice(0, modelId.indexOf(':')) as ProviderId;
  const upstream = modelId.slice(p.length + 1);
  return Object.prototype.hasOwnProperty.call(PROVIDER_NAMES, p) && upstream ? { name: prettyName(upstream), provider: PROVIDER_NAMES[p] } : null;
};

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-conversation');
  if (o instanceof Response) return o;
  // The incognito flag and the listener's thumbs (schema 24) are read on their own, so a database without them still opens chats.
  const [m, inc, rated] = await Promise.all([
    listMessages(ctx.env, o.conv.id),
    db.one<{ incognito: boolean | null }>(ctx.env, 'ai_conversations', q().eq('id', o.conv.id).select('incognito')),
    feedbackIn(ctx.env, o.sub, o.conv.id).catch(() => null),
  ]);
  if (!m.ok) return json({ error: 'unavailable' }, 503);
  const incognito = inc.ok && inc.value?.incognito === true;
  const messages = m.rows.map((r) => {
    const fb = r.role === 'assistant' ? rated?.[r.id] : undefined;
    return fb ? { ...publicMessage(r, label), feedback: fb } : publicMessage(r, label);
  });
  return json({ conversation: { ...publicConversation(o.conv), ...(incognito ? { incognito: true } : {}) }, messages });
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
  if ('projectId' in b) {
    if (b.projectId === null) patch.project_id = null;
    else if (!isUuid(b.projectId)) return json({ error: 'bad_request' }, 400);
    else {
      const p = await getProject(ctx.env, o.sub, b.projectId);
      if (!p.ok) return json({ error: 'unavailable' }, 503);
      if (!p.value) return json({ error: 'not_found' }, 404);
      patch.project_id = p.value.id;
    }
  }
  if (!Object.keys(patch).length) return json({ error: 'bad_request' }, 400);
  // Starring, switching branches or moving to a project is not a new message: updated_at stays.
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
  // Its shared link goes too. Not fatal: a link to a deleted chat already
  // reads as not found, and the purge's cascade removes the row a day later.
  await removeSharesOf(ctx.env, o.sub, o.conv.id);
  return json({ ok: true });
};
