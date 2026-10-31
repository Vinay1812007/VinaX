/**
 * VinaX AI — POST /api/ai/chat: send a message, stream the reply (SSE).
 *
 *   Authorization: Bearer <session>
 *   { conversationId: uuid | null,        // null = start a new conversation
 *     parentMessageId?: uuid | "root",     // where the new message hangs (edit = a sibling);
 *                                          // absent = after the conversation's active leaf;
 *                                          // "root" = a new first message (editing the first one)
 *     content: [{ type: "text", text }, { type: "attachment", id }],   // files from POST /api/ai/attachments;
 *                                          // empty + parentMessageId of a user message = retry
 *     continueFrom?: uuid,                 // an assistant message that was cut off: write on from where it stopped
 *     mode: "auto" | "model", model?: "<registry id>",
 *     extendedThinking?, webSearch?, artifacts? (default true), timezone?, locale? }
 *
 *   → 200 text/event-stream, named events, one JSON object per data line:
 *       meta     { conversationId, userMessageId, assistantMessageId, model: { id, name, provider }, continued? }
 *                (sent again when a failover changes the model; the page then clears any reasoning shown)
 *       title    { title }      (new conversations: a generated 2–6 word title, when it arrives in time)
 *       status   { step: "searching", query } · { step: "searched", count, sites }
 *       sources  { items: [{ n, url, title, site, snippet? }], via: "grounding" | "search", queries?, entryPointHtml?, markers? }
 *                (search: before the text, the model cites [n] itself; grounding: after the text,
 *                 with `markers` [{ at, ns }] saying where [n] goes in it)
 *       thinking { delta }
 *       text     { delta }
 *       error    { code, message, retryable, alternatives? }
 *       done     { stopReason: end | length | aborted | error, usage? }
 *   → 400 bad_request | bad_attachment | too_many_images | model_cannot_see_images · 409 too_many_files
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
import { db, dbConfigured, q } from '../../_lib/db';
import {
  attachmentPart, loadAttachments, MAX_FILES_PER_CONVERSATION, MAX_FILES_PER_MESSAGE, MAX_IMAGES_PER_MESSAGE, type AttachmentRow,
} from '../../_lib/ai/attachments';
import { fileSignals, materialize, newMemo, toTurns } from '../../_lib/ai/materialize';
import { anyProviderConfigured, PROVIDER_NAMES, providerConfigured } from '../../_lib/ai/adapters';
import { aiOpenFor, aiSettings, registryFor } from '../../_lib/ai/config';
import { isCooling } from '../../_lib/ai/cooldown';
import { fallbackTitle, latestLeaf, pathTo, textOf, trimHistory, typedText } from '../../_lib/ai/history';
import { ladderModels, modelById, type LadderName } from '../../_lib/ai/models';
import { generateTitle } from '../../_lib/ai/title';
import { buildSystemPrompt, firstNameOf, safeLocale, safeTimezone, type SearchBlock } from '../../_lib/ai/prompt';
import {
  applyMarkers, buildQuery, GROUNDING_DAILY_LIMIT, placeMarkers, searchMode, searchWeb, takeDaily, topicOf, wantsSearch,
  type Marker, type SearchResult,
} from '../../_lib/ai/search';
import { humanReason, pickLadder, runChat, type RunOptions } from '../../_lib/ai/router';
import { sseFrame } from '../../_lib/ai/sse';
import { artifactsOf } from '../../_lib/ai/artifacts';
import {
  createConversation, getConversation, insertMessage, isUuid, listMessages, MAX_MESSAGES, updateConversation, updateMessage,
  type ConversationRow, type MessageRow,
} from '../../_lib/ai/store';
import type { ProviderError } from '../../_lib/ai/errors';
import type { AiEnv, MessagePart, ModelSpec, Source } from '../../_lib/ai/types';

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
  webSearch?: unknown;
  artifacts?: unknown;
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

/** The text parts and the attachment ids of a message body, or an error code. */
export function parseContent(raw: unknown): { ok: true; parts: MessagePart[]; text: string; files: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, parts: [], text: '', files: [] };
  if (!Array.isArray(raw) || raw.length > 50) return { ok: false, error: 'bad_request' };
  const parts: MessagePart[] = [];
  const files: string[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'bad_request' };
    if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    else if (p.type === 'attachment' && isUuid(p.id)) { if (!files.includes(p.id)) files.push(p.id); }
    else return { ok: false, error: 'bad_request' };
  }
  if (files.length > MAX_FILES_PER_MESSAGE) return { ok: false, error: 'bad_attachment' };
  const text = textOf(parts);
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: 'too_long' };
  return { ok: true, parts: text.trim() ? parts : [], text, files };
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
  } else if (!content.parts.length && !content.files.length) {
    // Retry: a new answer to an existing question.
    const target = conv && isUuid(parentRaw) ? rows.find((r) => r.id === parentRaw && r.role === 'user') : undefined;
    if (!conv) return json({ error: 'bad_request' }, 400);
    if (!target) return json({ error: 'not_found' }, 404);
    userMsg = target;
  } else {
    if (rows.length >= MAX_MESSAGES) return json({ error: 'conversation_full' }, 409);
    // Files: the account's own, not yet in another conversation, within the limits.
    let newFiles: AttachmentRow[] = [];
    if (content.files.length) {
      const r = await loadAttachments(env, sub, content.files);
      if (!r.ok) return json({ error: 'unavailable' }, 503);
      const byId = new Map(r.rows.map((a) => [a.id, a]));
      newFiles = content.files.map((id) => byId.get(id)).filter((a): a is AttachmentRow => !!a);
      if (newFiles.length !== content.files.length || newFiles.some((a) => a.conversation_id && a.conversation_id !== conv?.id)) return json({ error: 'bad_attachment' }, 400);
      const images = newFiles.filter((a) => a.kind === 'image').length;
      if (images > MAX_IMAGES_PER_MESSAGE) return json({ error: 'too_many_images' }, 400);
      if (images && mode === 'model' && !candidates[0].flags.vision) return json({ error: 'model_cannot_see_images' }, 400);
      if (conv) {
        const have = await db.count(env, 'ai_attachments', q().eq('conversation_id', conv.id));
        const adding = newFiles.filter((a) => !a.conversation_id).length;
        if (have.ok && have.value + adding > MAX_FILES_PER_CONVERSATION) return json({ error: 'too_many_files' }, 409);
      }
    }
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
      const made = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: fallbackTitle(content.text || newFiles.map((a) => a.name).join(', ')), model_pref: mode === 'model' ? candidates[0].id : 'auto' });
      // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
      if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
      if (!made.rows[0]) return json({ error: 'unavailable' }, 503);
      conv = made.rows[0];
    }
    const unlinked = newFiles.filter((a) => !a.conversation_id).map((a) => a.id);
    if (unlinked.length) {
      const linked = await db.update(env, 'ai_attachments', q().eq('account_id', sub).in('id', unlinked).is('conversation_id', 'null'), { conversation_id: conv.id });
      if (!linked.ok) return json({ error: 'unavailable' }, 503);
    }
    // Files first, as the page shows them above the text.
    const row = { id: crypto.randomUUID(), conversation_id: conv.id, parent_id: parentId, role: 'user' as const, content: [...newFiles.map(attachmentPart), ...content.parts], created_at: new Date().toISOString() };
    const saved = await insertMessage(env, row);
    if (!saved.ok) return json({ error: 'unavailable' }, 503);
    userMsg = { thinking: null, thinking_ms: null, sources: null, artifacts: null, model_id: null, provider: null, stop_reason: null, usage: null, ...row };
    rows = [...rows, userMsg];
  }
  const isNew = rows.length === 1;
  const conversation = conv;
  const turns = toTurns(pathTo(rows, continuing ? continuing.id : userMsg.id));
  if (continuing) turns.push({ role: 'user', text: CONTINUE_PROMPT, files: [] });
  // Every file the thread refers to, loaded once.
  const fileIds = [...new Set(turns.flatMap((t) => t.files))];
  const fileRows = new Map<string, AttachmentRow>();
  if (fileIds.length) {
    const r = await loadAttachments(env, sub, fileIds);
    if (r.ok) for (const a of r.rows) fileRows.set(a.id, a);
  }
  const signals = fileSignals(turns, fileRows);
  const threadSize = turns.reduce((n, t) => n + t.text.length + t.files.reduce((m, id) => m + (fileRows.get(id)?.extracted_text?.length ?? 0), 0), 0);
  const latestText = typedText(userMsg.content);

  if (mode === 'auto') {
    ladder = pickLadder({ text: latestText, threadChars: threadSize, hasImages: signals.hasImages, hasPdf: signals.hasPdf, extendedThinking });
    candidates = ladderModels(registry, ladder);
    if (!candidates.length) candidates = ladderModels(registry, 'default');
    if (!candidates.length) candidates = registry.filter((spec) => spec.group !== null);
    if (!candidates.length) return json({ error: 'ai_not_configured' }, 503);
  }

  // Web search: at most one per turn, never for a Continue.
  const pathRows = pathTo(rows, userMsg.id);
  const previousUser = [...pathRows].reverse().find((r) => r.role === 'user' && r.id !== userMsg.id);
  const doSearch = !continuing && settings.search && wantsSearch(latestText, searchMode(body.webSearch));
  const query = doSearch ? buildQuery(latestText, previousUser ? typedText(previousUser.content) : null) : '';
  const topic = topicOf(latestText);
  let grounding = false;
  if (doSearch && query) {
    // Free Google Search grounding first, while today's allowance lasts.
    const grounded = ladderModels(registry, 'grounded');
    if (mode === 'model') grounding = candidates[0].flags.grounding && (await takeDaily(env, 'grounding', GROUNDING_DAILY_LIMIT));
    else if (grounded.length && (await takeDaily(env, 'grounding', GROUNDING_DAILY_LIMIT))) {
      grounding = true;
      candidates = [...grounded, ...candidates.filter((c) => !grounded.includes(c))];
    }
  }

  const account = await accountOf(env, sub);
  const vars = {
    now: new Date(),
    timezone: safeTimezone(body.timezone),
    locale: safeLocale(body.locale),
    firstName: firstNameOf(account.ok ? account.value?.name : null),
  };
  const slow = ladder === 'deep' || mode === 'model';
  // The search API runs once, and only if a model that cannot search itself answers.
  let apiSearch: Promise<SearchResult> | null = null;
  let searched: { items: Source[]; via: 'grounding' | 'search'; queries: string[]; entryPointHtml?: string } | null = null;
  let searchLog: Record<string, unknown> | null = null;
  const sitesOf = (items: Source[]) => [...new Set(items.map((i) => i.site))].slice(0, 4);
  const runApiSearch = (): Promise<SearchResult> => (apiSearch ??= (async () => {
    send('status', { step: 'searching', query });
    const r = await searchWeb(env, query, topic);
    if (r.ok) {
      searched = { items: r.sources, via: 'search', queries: [query] };
      send('status', { step: 'searched', count: r.sources.length, sites: sitesOf(r.sources) });
      send('sources', { items: r.sources, via: 'search' });
    } else send('status', { step: 'searched', count: 0, sites: [] });
    searchLog = { via: 'search', ok: r.ok, ...(r.ok ? { count: r.sources.length, cached: r.cached, provider: r.provider } : { reason: r.reason }) };
    return r;
  })());
  const memo = newMemo();
  const build: RunOptions['build'] = async (spec) => {
    const ground = grounding && spec.flags.grounding;
    let search: SearchBlock | null = null;
    if (doSearch && query && !ground) {
      const r = await runApiSearch();
      if (r.ok) search = { sources: r.sources };
    }
    // Artifacts are offered to capable models (flag `artifacts`) unless the page turned them off.
    const system = buildSystemPrompt({ spec, vars: { ...vars, modelName: spec.name, providerName: PROVIDER_NAMES[spec.provider] }, artifacts: body.artifacts !== false, search });
    const messages = await materialize(env, turns, spec, fileRows, memo);
    return {
      model: spec,
      system,
      messages: trimHistory(messages, Math.max(4_000, spec.maxContextChars - system.length)),
      maxOutputTokens: spec.maxOutput,
      reasoning: extendedThinking ? 'high' : 'default',
      webSearch: ground,
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
    let markers: Marker[] = [];
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
    if (grounding) send('status', { step: 'searching', query });
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
        } else if (ev.type === 'sources') {
          // Grounding: the sources arrive with the end of the answer.
          markers = placeMarkers(text, ev.supports ?? []);
          searched = { items: ev.items, via: 'grounding', queries: ev.queries, ...(ev.entryPointHtml ? { entryPointHtml: ev.entryPointHtml } : {}) };
          searchLog = { via: 'grounding', count: ev.items.length };
          send('status', { step: 'searched', count: ev.items.length, sites: sitesOf(ev.items) });
          send('sources', { ...searched, markers });
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
    const finalText = markers.length ? applyMarkers(text, markers) : text;
    if (continuing) {
      // Continue: the new text joins the reply it continues.
      if (savedReply) {
        const joined = textOf(continuing.content) + text;
        const found = artifactsOf(joined);
        await updateMessage(env, conversation.id, continuing.id, {
          content: [{ type: 'text', text: joined }],
          artifacts: found.length ? found : null,
          thinking: [continuing.thinking, thinking].filter(Boolean).join('\n\n') || null,
          model_id: model.id, provider: model.provider, stop_reason: stop, usage,
        });
      }
    } else if (savedReply) {
      await insertMessage(env, {
        id: assistantId, conversation_id: conversation.id, parent_id: userMsg.id, role: 'assistant',
        content: [{ type: 'text', text: finalText }], thinking: thinking || null, thinking_ms: thinkMs,
        sources: searched,
        artifacts: (() => { const found = artifactsOf(finalText); return found.length ? found : null; })(),
        model_id: model.id, provider: model.provider, stop_reason: stop, usage,
      });
    }
    await updateConversation(env, sub, conversation.id, {
      updated_at: new Date().toISOString(),
      active_leaf_id: savedReply || continuing ? assistantId : userMsg.id,
      model_pref: mode === 'model' ? model.id : 'auto',
    });
    if (titleJob) await titleJob;
    console.log(JSON.stringify({ route: 'ai-chat', continued: !!continuing, search: searchLog, model: model.id, provider: model.provider, ladder, ms: Date.now() - started, status: stop, input: usage?.input ?? null, output: usage?.output ?? null }));
  };

  const job = pump().catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(job);
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};
