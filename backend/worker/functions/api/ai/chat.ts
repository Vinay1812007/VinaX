/**
 * VinaX AI — POST /api/ai/chat: send a message, stream the reply (SSE).
 *
 *   Authorization: Bearer <session>
 *   { conversationId: uuid | null,        // null = start a new conversation
 *     parentMessageId?: uuid | "root",     // where the new message hangs (edit = a sibling);
 *                                          // absent = after the conversation's active leaf;
 *                                          // "root" = a new first message (editing the first one)
 *     content: [{ type: "text", text }],   // empty + parentMessageId of a user message = retry
 *     continueFrom?: uuid,                 // an assistant message that was cut off: write on from where it stopped
 *     mode: "auto" | "model", model?: "<registry id>",
 *     extendedThinking?, webSearch?, artifacts?, timezone?, locale? }
 *
 *   → 200 text/event-stream, named events, one JSON object per data line:
 *       meta     { conversationId, userMessageId, assistantMessageId, model: { id, name, provider }, continued? }
 *                (sent again when a failover changes the model; the page then clears any reasoning shown)
 *       title    { title }      (new conversations: a generated 2–6 word title, when it arrives in time)
 *       thinking { delta }
 *       text     { delta }
 *       error    { code, message, retryable, alternatives? }
 *       done     { stopReason: end | length | aborted | error, usage? }
 *   → 400 bad_request · 401 signed_out · 404 not_found · 409 conversation_full · 413 too_large
 *   → 429 rate_limited · 503 ai_not_configured | ai_disabled | unavailable
 *
 * The listener's message is saved before streaming; the reply is saved when
 * it ends (also after a disconnect, with the partial text and 'aborted').
 * A continued reply is appended to the message it continues.
 * Logs carry route, model, provider, latency, status and token counts, never
 * message text. See docs/ai.md.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, accountOf, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { bindingAllows, rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { anyProviderConfigured, PROVIDER_NAMES, providerConfigured } from '../../_lib/ai/adapters';
import { aiOpenFor, aiSettings, registryFor } from '../../_lib/ai/config';
import { isCooling } from '../../_lib/ai/cooldown';
import { fallbackTitle, latestLeaf, pathTo, textOf, threadChars, toNormalized, trimHistory } from '../../_lib/ai/history';
import { ladderModels, modelById, type LadderName } from '../../_lib/ai/models';
import { generateTitle } from '../../_lib/ai/title';
import { buildSystemPrompt, firstNameOf, safeLocale, safeTimezone } from '../../_lib/ai/prompt';
import { humanReason, pickLadder, runChat, type RunOptions } from '../../_lib/ai/router';
import { sseFrame } from '../../_lib/ai/sse';
import {
  createConversation, getConversation, insertMessage, isUuid, listMessages, MAX_MESSAGES, updateConversation, updateMessage,
  type ConversationRow, type MessageRow,
} from '../../_lib/ai/store';
import type { ProviderError } from '../../_lib/ai/errors';
import type { AiEnv, MessagePart, ModelSpec } from '../../_lib/ai/types';

/** Files travel separately (POST /api/ai/attachments, by id), so a chat body is only text. */
export const MAX_BODY_BYTES = 2_000_000;
export const MAX_TEXT_CHARS = 400_000;
export const FIRST_EVENT_MS = 12_000;
export const FIRST_EVENT_SLOW_MS = 25_000;
export const REPLY_BUDGET_MS = 120_000;
export const REPLY_BUDGET_SLOW_MS = 240_000;
/** How long the end of a first reply waits for its generated title. */
export const TITLE_WAIT_MS = 1_500;

/** The turn added to ask a model to carry on a reply that was cut off. */
export const CONTINUE_PROMPT = 'Continue your previous reply exactly where it stopped. Do not repeat anything you already wrote, do not restart or summarise; if it stopped mid-sentence or mid-code-block, carry on from that point.';

type StopReason = 'end' | 'length' | 'aborted' | 'error';

interface ChatBody {
  conversationId?: unknown;
  parentMessageId?: unknown;
  content?: unknown;
  mode?: unknown;
  model?: unknown;
  continueFrom?: unknown;
  extendedThinking?: unknown;
  timezone?: unknown;
  locale?: unknown;
}

interface Ctx {
  request: Request;
  env: AiEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-accel-buffering': 'no',
  ...CORS,
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

/** The text parts of a message body, or an error code. */
export function parseContent(raw: unknown): { ok: true; parts: MessagePart[]; text: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, parts: [], text: '' };
  if (!Array.isArray(raw) || raw.length > 50) return { ok: false, error: 'bad_request' };
  const parts: MessagePart[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'bad_request' };
    if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    // Attachments arrive in phase 4; until then they are refused, not dropped.
    else if (p.type === 'attachment') return { ok: false, error: 'attachments_unavailable' };
    else return { ok: false, error: 'bad_request' };
  }
  const text = textOf(parts);
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: 'too_long' };
  return { ok: true, parts: text.trim() ? parts : [], text };
}

const errorCode = (err: ProviderError, exhausted: boolean): string => {
  if (exhausted) return 'all_busy';
  switch (err.kind) {
    case 'rate':
    case 'quota': return 'model_busy';
    case 'timeout': return 'model_timeout';
    case 'empty': return 'empty_reply';
    default: return 'model_unavailable';
  }
};

const modelInfo = (spec: ModelSpec): { id: string; name: string; provider: string } => ({ id: spec.id, name: spec.name, provider: PROVIDER_NAMES[spec.provider] });

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-chat', { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if ((await bindingAllows(env, 'RATE_LIMIT_30', `ai-chat|account|${sub}`)) === false) {
    return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60', ...CORS } });
  }
  if (!anyProviderConfigured(env)) return json({ error: 'ai_not_configured' }, 503);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  const settings = await aiSettings(env);
  if (!aiOpenFor(settings, sub)) return json({ error: 'ai_disabled' }, 503);

  const read = await readJsonCapped<ChatBody | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  const content = parseContent(body.content);
  if (!content.ok) return json({ error: content.error }, content.error === 'too_long' ? 413 : 400);
  const mode = body.mode === 'model' ? 'model' : 'auto';
  const extendedThinking = body.extendedThinking === true;
  const parentRaw = body.parentMessageId;
  if (body.conversationId != null && !isUuid(body.conversationId)) return json({ error: 'not_found' }, 404);
  if (parentRaw != null && parentRaw !== 'root' && !isUuid(parentRaw)) return json({ error: 'bad_request' }, 400);
  const continueFrom = body.continueFrom;
  if (continueFrom != null && !isUuid(continueFrom)) return json({ error: 'bad_request' }, 400);

  // Which models may answer.
  const registry = registryFor(settings).filter((spec) => providerConfigured(env, spec.provider));
  let candidates: ModelSpec[];
  let ladder: LadderName | null = null;
  if (mode === 'model') {
    const spec = modelById(registry, body.model);
    if (!spec || spec.group === null) return json({ error: 'unknown_model' }, 400);
    candidates = [spec];
  } else candidates = [];

  // The conversation and the message tree.
  let conv: ConversationRow | null = null;
  let rows: MessageRow[] = [];
  if (isUuid(body.conversationId)) {
    const c = await getConversation(env, sub, body.conversationId);
    if (!c.ok) return json({ error: 'unavailable' }, 503);
    if (!c.value) return json({ error: 'not_found' }, 404);
    conv = c.value;
    const m = await listMessages(env, conv.id);
    if (!m.ok) return json({ error: 'unavailable' }, 503);
    rows = m.rows;
  }

  let userMsg: MessageRow;
  /** The cut-off reply being continued, if this is a Continue. */
  let continuing: MessageRow | null = null;
  if (isUuid(continueFrom)) {
    const target = conv ? rows.find((r) => r.id === continueFrom && r.role === 'assistant') : undefined;
    const question = target?.parent_id ? rows.find((r) => r.id === target.parent_id && r.role === 'user') : undefined;
    if (!conv) return json({ error: 'bad_request' }, 400);
    if (!target || !question) return json({ error: 'not_found' }, 404);
    continuing = target;
    userMsg = question;
  } else if (!content.parts.length) {
    // Retry: a new answer to an existing question.
    const target = conv && isUuid(parentRaw) ? rows.find((r) => r.id === parentRaw && r.role === 'user') : undefined;
    if (!conv) return json({ error: 'bad_request' }, 400);
    if (!target) return json({ error: 'not_found' }, 404);
    userMsg = target;
  } else {
    if (rows.length >= MAX_MESSAGES) return json({ error: 'conversation_full' }, 409);
    let parentId: string | null;
    if (parentRaw === 'root') parentId = null;
    else if (isUuid(parentRaw)) {
      if (!rows.some((r) => r.id === parentRaw)) return json({ error: 'not_found' }, 404);
      parentId = parentRaw;
    } else {
      const active = conv?.active_leaf_id && rows.some((r) => r.id === conv?.active_leaf_id) ? conv.active_leaf_id : null;
      parentId = active ?? latestLeaf(rows)?.id ?? null;
    }
    if (!conv) {
      const made = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: fallbackTitle(content.text), model_pref: mode === 'model' ? candidates[0].id : 'auto' });
      // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
      if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
      if (!made.rows[0]) return json({ error: 'unavailable' }, 503);
      conv = made.rows[0];
    }
    const row = { id: crypto.randomUUID(), conversation_id: conv.id, parent_id: parentId, role: 'user' as const, content: content.parts, created_at: new Date().toISOString() };
    const saved = await insertMessage(env, row);
    if (!saved.ok) return json({ error: 'unavailable' }, 503);
    userMsg = { thinking: null, thinking_ms: null, sources: null, artifacts: null, model_id: null, provider: null, stop_reason: null, usage: null, ...row };
    rows = [...rows, userMsg];
  }
  const isNew = rows.length === 1;
  const conversation = conv;
  const history = continuing
    ? [...toNormalized(pathTo(rows, continuing.id)), { role: 'user' as const, text: CONTINUE_PROMPT }]
    : toNormalized(pathTo(rows, userMsg.id));
  const latestText = textOf(userMsg.content);

  if (mode === 'auto') {
    ladder = pickLadder({ text: latestText, threadChars: threadChars(history), hasImages: false, hasPdf: false, extendedThinking });
    candidates = ladderModels(registry, ladder);
    if (!candidates.length) candidates = ladderModels(registry, 'default');
    if (!candidates.length) candidates = registry.filter((spec) => spec.group !== null);
    if (!candidates.length) return json({ error: 'ai_not_configured' }, 503);
  }

  const account = await accountOf(env, sub);
  const vars = {
    now: new Date(),
    timezone: safeTimezone(body.timezone),
    locale: safeLocale(body.locale),
    firstName: firstNameOf(account.ok ? account.value?.name : null),
  };
  const slow = ladder === 'deep' || mode === 'model';
  const build: RunOptions['build'] = (spec) => {
    const system = buildSystemPrompt({ spec, vars: { ...vars, modelName: spec.name, providerName: PROVIDER_NAMES[spec.provider] }, artifacts: false });
    return {
      model: spec,
      system,
      messages: trimHistory(history, Math.max(4_000, spec.maxContextChars - system.length)),
      maxOutputTokens: spec.maxOutput,
      reasoning: extendedThinking ? 'high' : 'default',
      webSearch: false,
    };
  };
  const alternativesFor = (failed: ModelSpec): Array<{ id: string; name: string; provider: string }> =>
    registry.filter((spec) => spec.group !== null && spec.id !== failed.id && !isCooling(spec)).slice(0, 2).map(modelInfo);

  const abort = new AbortController();
  const assistantId = continuing?.id ?? crypto.randomUUID();
  const titleCandidates = ladderModels(registry, 'title');
  let open = true;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { open = false; abort.abort(); },
  });
  const send = (event: string, data: unknown): void => {
    if (!open) return;
    try { controller.enqueue(sseFrame(event, data)); } catch { open = false; }
  };

  const pump = async (): Promise<void> => {
    const started = Date.now();
    let model = candidates[0];
    let text = '';
    let thinking = '';
    let thinkStart: number | null = null;
    let thinkMs: number | null = null;
    let usage: { input: number; output: number } | null = null;
    let stop: StopReason = 'end';
    const metaOf = (m: ModelSpec) => ({ conversationId: conversation.id, userMessageId: userMsg.id, assistantMessageId: assistantId, model: modelInfo(m), ...(continuing ? { continued: true } : {}) });
    send('meta', metaOf(model));
    // A new conversation gets a generated title, written in parallel with the reply.
    let titleJob: Promise<void> | null = null;
    if (isNew) {
      send('title', { title: conversation.title });
      titleJob = generateTitle(env, titleCandidates, textOf(userMsg.content)).then(async (title) => {
        if (!title || title === conversation.title) return;
        send('title', { title });
        await updateConversation(env, sub, conversation.id, { title });
      }).catch(() => undefined);
    }
    try {
      for await (const ev of runChat(env, {
        candidates, picked: mode === 'model', build, signal: abort.signal,
        firstEventMs: slow ? FIRST_EVENT_SLOW_MS : FIRST_EVENT_MS,
        budgetMs: slow ? REPLY_BUDGET_SLOW_MS : REPLY_BUDGET_MS,
      })) {
        if (ev.type === 'model') {
          if (ev.spec.id !== model.id) {
            model = ev.spec;
            thinking = '';
            thinkStart = null;
            send('meta', metaOf(model));
          }
        } else if (ev.type === 'thinking') {
          thinkStart ??= Date.now();
          thinking += ev.delta;
          send('thinking', { delta: ev.delta });
        } else if (ev.type === 'text') {
          if (thinkStart != null && thinkMs == null) thinkMs = Date.now() - thinkStart;
          text += ev.delta;
          send('text', { delta: ev.delta });
        } else if (ev.type === 'usage') {
          usage = { input: ev.input, output: ev.output };
        } else if (ev.type === 'end') {
          stop = ev.reason === 'length' ? 'length' : 'end';
        } else if (ev.type === 'failed') {
          stop = 'error';
          const exhausted = mode === 'auto' && !ev.partial;
          send('error', {
            code: errorCode(ev.error, exhausted),
            message: exhausted ? 'VinaX AI is busy right now. Try again in a moment.' : humanReason(ev.error, ev.spec),
            retryable: true,
            ...(mode === 'model' && !ev.partial ? { alternatives: alternativesFor(model) } : {}),
          });
        }
      }
    } catch {
      stop = 'error';
      send('error', { code: 'model_unavailable', message: 'VinaX AI couldn’t answer just now.', retryable: true });
    }
    if (abort.signal.aborted) stop = 'aborted';
    if (thinkStart != null && thinkMs == null) thinkMs = Date.now() - thinkStart;
    // Give the title a moment to arrive in this stream; it is saved whenever it comes.
    if (titleJob && open) await Promise.race([titleJob, new Promise((r) => setTimeout(r, TITLE_WAIT_MS))]);
    send('done', { stopReason: stop, ...(usage ? { usage } : {}) });
    if (open) {
      open = false;
      try { controller.close(); } catch { /* the reader is gone */ }
    }

    // Save the reply (also a partial or stopped one) and move the active leaf.
    const savedReply = text.trim().length > 0;
    if (continuing) {
      // Continue: the new text joins the reply it continues.
      if (savedReply) {
        await updateMessage(env, conversation.id, continuing.id, {
          content: [{ type: 'text', text: textOf(continuing.content) + text }],
          thinking: [continuing.thinking, thinking].filter(Boolean).join('\n\n') || null,
          model_id: model.id, provider: model.provider, stop_reason: stop, usage,
        });
      }
    } else if (savedReply) {
      await insertMessage(env, {
        id: assistantId, conversation_id: conversation.id, parent_id: userMsg.id, role: 'assistant',
        content: [{ type: 'text', text }], thinking: thinking || null, thinking_ms: thinkMs,
        model_id: model.id, provider: model.provider, stop_reason: stop, usage,
      });
    }
    await updateConversation(env, sub, conversation.id, {
      updated_at: new Date().toISOString(),
      active_leaf_id: savedReply || continuing ? assistantId : userMsg.id,
      model_pref: mode === 'model' ? model.id : 'auto',
    });
    if (titleJob) await titleJob;
    console.log(JSON.stringify({ route: 'ai-chat', continued: !!continuing, model: model.id, provider: model.provider, ladder, ms: Date.now() - started, status: stop, input: usage?.input ?? null, output: usage?.output ?? null }));
  };

  const job = pump().catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(job);
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};
