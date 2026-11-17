/**
 * VinaX AI — POST /api/ai/images: Create image. Makes one picture from a
 * prompt with Workers AI's FLUX.1 schnell (_lib/ai/images.ts), keeps it in
 * the private `ai-attachments` bucket like any chat file, and saves the turn
 * in the conversation, so it is there after a reload:
 *
 *   user       "Create an image: <prompt>"
 *   assistant  "Here’s your image." + the picture (an image attachment)
 *
 *   Authorization: Bearer <session>
 *   { prompt: string,                     // 1–1,000 characters
 *     conversationId: uuid | null,        // null = start a new conversation
 *     parentMessageId?: uuid | "root",    // absent = after the conversation's active leaf
 *     projectId?: uuid,                   // a new conversation starts in this project
 *     incognito?: true }                  // a new conversation that never uses memory
 *
 *   → 200 { conversation, userMessage, assistantMessage }   (the shapes GET /api/ai/conversations/:id uses)
 *   → 400 bad_request | empty_prompt | prompt_refused · 413 prompt_too_long
 *   → 401 signed_out · 404 not_found · 409 conversation_full | too_many_files
 *   → 429 rate_limited | image_daily_limit { limit } | images_busy (the day's free pool is spent: try tomorrow)
 *   → 422 image_refused (the model would not draw it) · 502 image_failed
 *   → 503 ai_disabled | images_off | ai_not_configured | unavailable
 *
 * Off unless the owner switches `vinax-ai.images` on. Each person may make
 * `images.perDay` pictures a day (default 10) and everyone together 50; both
 * are taken before the model runs and kept even when it fails, so the
 * neurons are counted high, never low. Signed-in accounts only. Logs carry
 * the route, timing and outcome, never the prompt.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { aiOpenFor, aiSettings } from '../../_lib/ai/config';
import { attachmentPart, type AttachmentRow } from '../../_lib/ai/attachments';
import { fallbackTitle, latestLeaf } from '../../_lib/ai/history';
import {
  checkPrompt, generateImage, IMAGE_MODEL_ID, IMAGE_MODEL_LABEL, imageFileName, IMAGES_PER_DAY_TOTAL, NEURONS_PER_IMAGE,
} from '../../_lib/ai/images';
import { markIncognito } from '../../_lib/ai/memory';
import { getProject } from '../../_lib/ai/projects';
import { storagePut, storageRemove } from '../../_lib/ai/storage';
import {
  createConversation, getConversation, insertMessage, isUuid, listMessages, MAX_MESSAGES, publicConversation, publicMessage, updateConversation,
  type ConversationRow, type MessageRow,
} from '../../_lib/ai/store';
import type { AiEnv } from '../../_lib/ai/types';

/** The request is a prompt and a few ids. */
export const MAX_BODY_BYTES = 8_192;
/** What the listener's turn says, so later replies know a picture was asked for. */
export const IMAGE_REQUEST_PREFIX = 'Create an image: ';
export const IMAGE_REPLY_TEXT = 'Here’s your image.';

interface Body {
  prompt?: unknown;
  conversationId?: unknown;
  parentMessageId?: unknown;
  projectId?: unknown;
  incognito?: unknown;
}

interface Ctx { request: Request; env: AiEnv }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

const label = (id: string) => (id === IMAGE_MODEL_ID ? IMAGE_MODEL_LABEL : null);

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-images', { capacity: 5, refillPerMinute: 5 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const settings = await aiSettings(env);
  if (!aiOpenFor(settings, sub)) return json({ error: 'ai_disabled' }, 503);
  if (!settings.images.enabled) return json({ error: 'images_off' }, 503);
  if (!env.AI || typeof env.AI.run !== 'function') return json({ error: 'ai_not_configured' }, 503);

  const read = await readJsonCapped<Body | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'prompt_too_long' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  const checked = checkPrompt(body.prompt);
  if (!checked.ok) return json({ error: checked.error }, checked.error === 'prompt_too_long' ? 413 : 400);
  const prompt = checked.prompt;
  if (body.conversationId != null && !isUuid(body.conversationId)) return json({ error: 'not_found' }, 404);
  const parentRaw = body.parentMessageId;
  if (parentRaw != null && parentRaw !== 'root' && !isUuid(parentRaw)) return json({ error: 'bad_request' }, 400);
  if (body.projectId != null && !isUuid(body.projectId)) return json({ error: 'bad_request' }, 400);

  // The conversation, where the turn hangs, and room for one more file.
  let conv: ConversationRow | null = null;
  let rows: MessageRow[] = [];
  if (isUuid(body.conversationId)) {
    const [c, m] = await Promise.all([getConversation(env, sub, body.conversationId), listMessages(env, body.conversationId)]);
    if (!c.ok) return json({ error: 'unavailable' }, 503);
    if (!c.value) return json({ error: 'not_found' }, 404);
    if (!m.ok) return json({ error: 'unavailable' }, 503);
    conv = c.value;
    rows = m.rows;
    if (rows.length + 2 > MAX_MESSAGES) return json({ error: 'conversation_full' }, 409);
    const have = await db.count(env, 'ai_attachments', q().eq('conversation_id', conv.id));
    if (have.ok && have.value >= settings.limits.filesPerChat) return json({ error: 'too_many_files' }, 409);
  }
  let parentId: string | null = null;
  if (conv) {
    if (parentRaw === 'root') parentId = null;
    else if (isUuid(parentRaw)) {
      if (!rows.some((r) => r.id === parentRaw)) return json({ error: 'not_found' }, 404);
      parentId = parentRaw;
    } else {
      const active = conv.active_leaf_id && rows.some((r) => r.id === conv?.active_leaf_id) ? conv.active_leaf_id : null;
      parentId = active ?? latestLeaf(rows)?.id ?? null;
    }
  }
  let projectId: string | null = null;
  if (!conv && isUuid(body.projectId)) {
    const p = await getProject(env, sub, body.projectId);
    if (!p.ok) return json({ error: 'unavailable' }, 503);
    if (!p.value) return json({ error: 'not_found' }, 404);
    projectId = p.value.id;
  }

  // The caps, before any neuron is spent: this person's day, then everyone's.
  // An unreadable counter refuses (the pool is shared with the chat models).
  const mine = await db.rpc<boolean>(env, 'ai_take_daily', { p_kind: `img:${sub}`, p_limit: settings.images.perDay });
  if (!mine.ok) return json({ error: 'unavailable' }, 503);
  if (mine.value !== true) return json({ error: 'image_daily_limit', limit: settings.images.perDay }, 429);
  const all = await db.rpc<boolean>(env, 'ai_take_daily', { p_kind: 'images', p_limit: IMAGES_PER_DAY_TOTAL });
  if (!all.ok) return json({ error: 'unavailable' }, 503);
  if (all.value !== true) return json({ error: 'images_busy' }, 429);

  const made = await generateImage(env, prompt);
  const log = (status: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ route: 'ai-images', model: IMAGE_MODEL_ID, status, neurons: NEURONS_PER_IMAGE, ...extra }));
  if (!made.ok) {
    log(made.error, made.cause ? { kind: made.cause.kind } : {});
    if (made.error === 'images_busy') return json({ error: 'images_busy' }, 429);
    if (made.error === 'image_refused') return json({ error: 'image_refused' }, 422);
    if (made.error === 'not_configured') return json({ error: 'ai_not_configured' }, 503);
    return json({ error: 'image_failed' }, 502);
  }

  // A new conversation is made only now, so a refusal leaves nothing behind.
  let created = false;
  if (!conv) {
    const madeConv = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: fallbackTitle(prompt), model_pref: 'auto', project_id: projectId });
    // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
    if (!madeConv.ok) return madeConv.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
    if (!madeConv.rows[0]) return json({ error: 'unavailable' }, 503);
    conv = madeConv.rows[0];
    created = true;
    if (body.incognito === true) await markIncognito(env, sub, conv.id);
  }

  const fileId = crypto.randomUUID();
  const path = `${sub}/${conv.id}/${fileId}`;
  if (!(await storagePut(env, path, new Uint8Array(made.bytes), made.mime, made.bytes.length))) return json({ error: 'unavailable' }, 503);
  const now = new Date().toISOString();
  const file: AttachmentRow = {
    id: fileId, account_id: sub, conversation_id: conv.id, name: imageFileName(prompt, made.mime), mime: made.mime, size: made.bytes.length, kind: 'image',
    storage_path: path, extracted_text: null, pages: null, gemini_uri: null, gemini_expires_at: null, created_at: now,
  };
  const savedFile = await db.insert(env, 'ai_attachments', {
    id: file.id, account_id: sub, conversation_id: conv.id, name: file.name, mime: file.mime, size: file.size, kind: 'image', storage_path: path, extracted_text: null,
  });
  if (!savedFile.ok) {
    await storageRemove(env, [path]);
    return json({ error: 'unavailable' }, 503);
  }

  const user: MessageRow = {
    id: crypto.randomUUID(), conversation_id: conv.id, parent_id: parentId, role: 'user', content: [{ type: 'text', text: `${IMAGE_REQUEST_PREFIX}${prompt}` }],
    thinking: null, thinking_ms: null, sources: null, artifacts: null, model_id: null, provider: null, stop_reason: null, usage: null, created_at: now,
  };
  // A moment later, so the reply always sorts after its question.
  const reply: MessageRow = {
    ...user, id: crypto.randomUUID(), parent_id: user.id, role: 'assistant', content: [{ type: 'text', text: IMAGE_REPLY_TEXT }, attachmentPart(file)],
    model_id: IMAGE_MODEL_ID, provider: 'cloudflare', stop_reason: 'end', created_at: new Date(Date.parse(now) + 1).toISOString(),
  };
  const savedUser = await insertMessage(env, user);
  const savedReply = savedUser.ok ? await insertMessage(env, reply) : savedUser;
  if (!savedReply.ok) {
    log('save_failed');
    return json({ error: 'unavailable' }, 503);
  }
  const updated = await updateConversation(env, sub, conv.id, { updated_at: new Date().toISOString(), active_leaf_id: reply.id });
  const convOut = updated.ok && updated.rows?.[0] ? updated.rows[0] : { ...conv, active_leaf_id: reply.id };
  log('ok', { ms: made.ms, created });
  return json({
    conversation: { ...publicConversation(convOut), ...(created && body.incognito === true ? { incognito: true } : {}) },
    userMessage: publicMessage(user, label),
    assistantMessage: publicMessage(reply, label),
  });
};
