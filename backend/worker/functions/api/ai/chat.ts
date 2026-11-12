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
 *     extendedThinking?, webSearch?, artifacts? (default true), timezone?, locale?,
 *     personal?: { name?, about?, instructions?, style? },    // VinaX AI settings → Personalisation; used for this reply only, never stored
 *     projectId?: uuid,                   // a new conversation starts in this project (its instructions and files join every reply)
 *     incognito?: true,                    // a chat that never reads or writes memory; kept on a new chat (memory.ts)
 *     passthrough?: true }                 // the page reads the provider's own lines (below); without it, named text events
 *
 *   → 200 text/event-stream, named events, one JSON object per data line:
 *       meta     { conversationId, userMessageId, assistantMessageId, model: { id, name, provider }, continued? }
 *                (sent again when a failover changes the model; the page then clears any reasoning shown)
 *       title    { title }      (new conversations: a generated 2–6 word title, when it arrives in time)
 *       status   { step: "searching", query } · { step: "searched", count, sites }
 *       sources  { items: [{ n, url, title, site, snippet? }], via: "grounding" | "search", queries?, entryPointHtml?, markers? }
 *                (search: before the text, the model cites [n] itself; grounding: after the text,
 *                 with `markers` [{ at, ns }] saying where [n] goes in it)
 *       thinking { delta }   (without `passthrough` only)
 *       text     { delta }   (without `passthrough` only)
 *       error    { code, message, retryable, alternatives? }
 *       done     { stopReason: end | length | aborted | error, usage?, saved }
 *
 *   Pass-through (`passthrough: true`): between the opening events and the
 *   closing ones (error, sources, done) come the provider's own `data:` lines,
 *   untouched and without an event name; `meta.wire` says how they are
 *   written and the page reads the text out of them (frontend vinaxai/wire.ts).
 *   Relaying them token by token cost about a second of CPU for a long reply
 *   and the free plan's 10 ms limit cut such replies off; bytes handed on
 *   cost almost nothing (passthrough.ts).
 *   → 400 bad_request | bad_attachment | too_many_images | model_cannot_see_images · 409 too_many_files
 *   → 400 bad_request · 401 signed_out · 404 not_found · 409 conversation_full · 413 too_large
 *   → 429 rate_limited · 503 ai_not_configured | ai_disabled | unavailable
 *
 * The listener's message is saved before streaming; the reply is saved when
 * it ends. One that did not end on its own (Stop, a broken stream) is only
 * whole on the page, which saves it (POST /api/ai/keep; `done.saved` false);
 * without pass-through the relayed text is saved here as before.
 * A continued reply is appended to the message it continues.
 * Logs carry route, model, provider, latency, status and token counts, never
 * message text. See README.md (VinaX AI).
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, accountOf, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { bindingAllows, rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import {
  attachmentPart, loadAttachments, type AttachmentRow,
} from '../../_lib/ai/attachments';
import { fileSignals, materialize, newMemo, toTurns } from '../../_lib/ai/materialize';
import { ADAPTERS, anyProviderConfigured, PROVIDER_NAMES, providerConfigured } from '../../_lib/ai/adapters';
import { aiOpenFor, aiSettings, foundModelFor, LIMIT_RANGES, registryFor } from '../../_lib/ai/config';
import { isCooling, noteFailure } from '../../_lib/ai/cooldown';
import { fallbackTitle, latestLeaf, pathTo, textOf, trimHistory, typedText } from '../../_lib/ai/history';
import { ladderModels, modelById, type LadderName } from '../../_lib/ai/models';
import { generateTitle } from '../../_lib/ai/title';
import { buildSystemPrompt, firstNameOf, safeLocale, safeTimezone, sanitizePersonal, type SearchBlock } from '../../_lib/ai/prompt';
import {
  applyMarkers, buildQuery, GROUNDING_DAILY_LIMIT, placeMarkers, searchMode, searchWeb, takeDaily, topicOf, wantsSearch,
  type Marker, type SearchResult,
} from '../../_lib/ai/search';
import { humanReason, pickLadder, type RunOptions } from '../../_lib/ai/router';
import { collect, openModel, textBody } from '../../_lib/ai/passthrough';
import { sseFrame } from '../../_lib/ai/sse';
import { artifactsOf } from '../../_lib/ai/artifacts';
import { getProject, knowledgeFor, loadProjectContext, longKnowledge, withKnowledge } from '../../_lib/ai/projects';
import { learnCandidates, learnFromChat, markIncognito, memoryBlock, memoryFor, NO_MEMORY, shouldLearn } from '../../_lib/ai/memory';
import {
  createConversation, getConversation, insertMessage, isUuid, listMessages, MAX_MESSAGES, updateConversation, updateMessage,
  type ConversationRow, type MessageRow,
} from '../../_lib/ai/store';
import { ProviderError } from '../../_lib/ai/errors';
import type { AiEnv, MessagePart, ModelSpec, Source } from '../../_lib/ai/types';

/** Files travel separately (POST /api/ai/attachments, by id), so a chat body is only text. */
export const MAX_BODY_BYTES = 2_000_000;
export const MAX_TEXT_CHARS = 400_000;
export const FIRST_EVENT_MS = 12_000;
export const FIRST_EVENT_SLOW_MS = 25_000;
/** Room for a long page or app (16K tokens at ~60 a second, after thinking). */
export const REPLY_BUDGET_MS = 360_000;
export const REPLY_BUDGET_SLOW_MS = 480_000;

/**
 * How long to wait for the first event: longer for the deep ladder and a
 * picked model, and as long as a picked model's own `firstEventMs` when it
 * is slow to start.
 */
export function firstEventMsFor(slow: boolean, picked: ModelSpec | null): number {
  return Math.max(slow ? FIRST_EVENT_SLOW_MS : FIRST_EVENT_MS, picked?.firstEventMs ?? 0);
}
/**
 * A finished reply larger than this (the provider's raw lines) is not read
 * again here to be saved: parsing it costs more CPU than the free plan
 * allows (about 8 ms a megabyte; a 16K-token NVIDIA reply is about 5 MB of
 * lines, 40 ms, and Cloudflare cut it off before the closing events,
 * 2026-11-12). The page, which already has
 * the text, saves it instead (POST /api/ai/keep), told by `saved: false`.
 */
export const PARSE_MAX_CHARS = 1_000_000;

/** How a reply too large to parse ended, from its last lines: the length limit, or its own end. */
export function tailStop(raw: string): 'length' | 'end' {
  return /"finish_reason"\s*:\s*"length"|"finishReason"\s*:\s*"MAX_TOKENS"/.test(raw.slice(-20_000)) ? 'length' : 'end';
}

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
  personal?: unknown;
  projectId?: unknown;
  incognito?: unknown;
  passthrough?: unknown;
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
  // The owner's files-per-message limit is checked by the route; this is the ceiling it can be set to.
  if (files.length > LIMIT_RANGES.filesPerMessage[1]) return { ok: false, error: 'bad_attachment' };
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

const enc = new TextEncoder();

/**
 * The response body: the platform's native pipe on Workers (bytes piped
 * into it never wake this code; a page that goes away fails the pipe), a
 * plain TransformStream elsewhere (tests), which says so through `onCancel`.
 */
function makePipe(onCancel: () => void): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
  const Native = (globalThis as { IdentityTransformStream?: new () => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).IdentityTransformStream;
  return Native ? new Native() : new TransformStream<Uint8Array, Uint8Array>({ cancel: onCancel } as Transformer<Uint8Array, Uint8Array>);
}

const modelInfo = (spec: ModelSpec): { id: string; name: string; provider: string } => ({ id: spec.id, name: spec.name, provider: PROVIDER_NAMES[spec.provider] });

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  // The owner's per-minute limit (memoised setting read), with a burst of twice that.
  const perMinute = dbConfigured(env) ? (await aiSettings(env)).limits.messagesPerMinute : 10;
  const limited = await rateLimitAsync(request, 'ai-chat', { capacity: perMinute * 2, refillPerMinute: perMinute }, env);
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
  if (content.files.length > settings.limits.filesPerMessage) return json({ error: 'bad_attachment' }, 400);
  // The owner's daily message limit per person (vinax-ai.dailyLimit). The
  // shared ai_take_daily counter refuses once the day's count is reached;
  // an unreadable counter lets the message through rather than lock people out.
  // Counted while the conversation loads; answered before anything is written.
  const dailyJob = settings.dailyLimit ? db.rpc<boolean>(env, 'ai_take_daily', { p_kind: `msg:${sub}`, p_limit: settings.dailyLimit }) : null;
  const mode = body.mode === 'model' ? 'model' : 'auto';
  /** The page reads the provider's own lines (vinaxai/wire.ts); older pages get named text events. */
  const passthrough = body.passthrough === true;
  const extendedThinking = body.extendedThinking === true;
  const parentRaw = body.parentMessageId;
  if (body.conversationId != null && !isUuid(body.conversationId)) return json({ error: 'not_found' }, 404);
  if (parentRaw != null && parentRaw !== 'root' && !isUuid(parentRaw)) return json({ error: 'bad_request' }, 400);
  const continueFrom = body.continueFrom;
  if (continueFrom != null && !isUuid(continueFrom)) return json({ error: 'bad_request' }, 400);
  if (body.projectId != null && !isUuid(body.projectId)) return json({ error: 'bad_request' }, 400);

  // Which models may answer.
  const registry = registryFor(settings).filter((spec) => providerConfigured(env, spec.provider));
  let candidates: ModelSpec[];
  let ladder: LadderName | null = null;
  if (mode === 'model') {
    // A curated model, or a free one found in its provider's current list (never an arbitrary id).
    const spec = modelById(registry, body.model) ?? (await foundModelFor(env, settings, body.model, { waitUntil: ctx.waitUntil }));
    if (!spec || spec.group === null || !providerConfigured(env, spec.provider)) return json({ error: 'unknown_model' }, 400);
    candidates = [spec];
  } else candidates = [];

  // The conversation and the message tree.
  // The listener's name for the prompt, read while the rest is checked (it never blocks a refusal).
  const accountJob = accountOf(env, sub).catch(() => ({ ok: false as const }));
  let conv: ConversationRow | null = null;
  let rows: MessageRow[] = [];
  if (isUuid(body.conversationId)) {
    // Both at once; the messages are used only once the conversation is known to be this account's.
    const [c, m] = await Promise.all([getConversation(env, sub, body.conversationId), listMessages(env, body.conversationId)]);
    if (!c.ok) return json({ error: 'unavailable' }, 503);
    if (!c.value) return json({ error: 'not_found' }, 404);
    conv = c.value;
    if (!m.ok) return json({ error: 'unavailable' }, 503);
    rows = m.rows;
  }
  if (dailyJob) {
    const took = await dailyJob;
    if (took.ok && took.value !== true) return json({ error: 'daily_limit', limit: settings.dailyLimit }, 429);
  }

  let userMsg: MessageRow;
  /** A new message (not a retry or a Continue). */
  let fresh = false;
  /** The new question's save, run while the model starts; the reply is saved only once it is in. */
  let userSaved: Promise<boolean> = Promise.resolve(true);
  /** This request made the conversation. */
  let created = false;
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
      if (images > settings.limits.imagesPerMessage) return json({ error: 'too_many_images' }, 400);
      if (images && mode === 'model' && !candidates[0].flags.vision) return json({ error: 'model_cannot_see_images' }, 400);
      if (conv) {
        const have = await db.count(env, 'ai_attachments', q().eq('conversation_id', conv.id));
        const adding = newFiles.filter((a) => !a.conversation_id).length;
        if (have.ok && have.value + adding > settings.limits.filesPerChat) return json({ error: 'too_many_files' }, 409);
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
      // A new chat started in a project: the project must be the account's own.
      let projectId: string | null = null;
      if (isUuid(body.projectId)) {
        const p = await getProject(env, sub, body.projectId);
        if (!p.ok) return json({ error: 'unavailable' }, 503);
        if (!p.value) return json({ error: 'not_found' }, 404);
        projectId = p.value.id;
      }
      const made = await createConversation(env, { id: crypto.randomUUID(), account_id: sub, title: fallbackTitle(content.text || newFiles.map((a) => a.name).join(', ')), model_pref: mode === 'model' ? candidates[0].id : 'auto', project_id: projectId });
      // 23503: the account row is gone (deleted elsewhere), so the session no longer stands.
      if (!made.ok) return made.code === '23503' ? json({ error: 'signed_out' }, 401) : json({ error: 'unavailable' }, 503);
      if (!made.rows[0]) return json({ error: 'unavailable' }, 503);
      conv = made.rows[0];
      created = true;
    }
    const unlinked = newFiles.filter((a) => !a.conversation_id).map((a) => a.id);
    if (unlinked.length) {
      const linked = await db.update(env, 'ai_attachments', q().eq('account_id', sub).in('id', unlinked).is('conversation_id', 'null'), { conversation_id: conv.id });
      if (!linked.ok) return json({ error: 'unavailable' }, 503);
    }
    // Files first, as the page shows them above the text.
    const row = { id: crypto.randomUUID(), conversation_id: conv.id, parent_id: parentId, role: 'user' as const, content: [...newFiles.map(attachmentPart), ...content.parts], created_at: new Date().toISOString() };
    const convId = conv.id;
    const markFirst = created && body.incognito === true;
    userSaved = (async () => {
      if (markFirst) await markIncognito(env, sub, convId);
      return (await insertMessage(env, row)).ok;
    })().catch(() => false);
    userMsg = { thinking: null, thinking_ms: null, sources: null, artifacts: null, model_id: null, provider: null, stop_reason: null, usage: null, ...row };
    fresh = true;
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
  // Memory is read while the project loads and the search allowance is taken.
  const memoryJob = memoryFor(env, sub, conversation.id, body.incognito === true).catch(() => NO_MEMORY);
  // The chat's project (its instructions and knowledge), when it has one.
  const project = await loadProjectContext(env, sub, conversation.project_id);
  const threadSize = (project?.chars ?? 0) + turns.reduce((n, t) => n + t.text.length + t.files.reduce((m, id) => m + (fileRows.get(id)?.extracted_text?.length ?? 0), 0), 0);
  const latestText = typedText(userMsg.content);

  if (mode === 'auto') {
    ladder = pickLadder({ text: latestText, threadChars: threadSize, hasImages: signals.hasImages, hasPdf: signals.hasPdf || longKnowledge(project), extendedThinking });
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

  const [account, memory] = await Promise.all([accountJob, memoryJob]);
  const memoryText = memoryBlock(memory, latestText);
  // Learning runs after a new message (not a retry or a Continue) on its turn.
  const learnNow = memory.learn && fresh && shouldLearn(pathRows.filter((r) => r.role === 'user').length, latestText);
  const vars = {
    now: new Date(),
    timezone: safeTimezone(body.timezone),
    locale: safeLocale(body.locale),
    firstName: firstNameOf(account.ok ? account.value?.name : null),
  };
  const personal = sanitizePersonal(body.personal);
  const slow = ladder === 'deep' || mode === 'model';
  // The search API runs once, and only if a model that cannot search itself answers.
  let apiSearch: Promise<SearchResult> | null = null;
  let searched: { items: Source[]; via: 'grounding' | 'search'; queries: string[]; entryPointHtml?: string } | null = null;
  let searchLog: Record<string, unknown> | null = null;
  const sitesOf = (items: Source[]) => [...new Set(items.map((i) => i.site))].slice(0, 4);
  const runApiSearch = (): Promise<SearchResult> => (apiSearch ??= (async () => {
    send('status', { step: 'searching', query });
    const r = await searchWeb(env, query, topic, Date.now(), settings.limits.searchesPerDay);
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
    // Artifacts go to every model with room for them (prompt.ts) unless the page turned them off.
    const knowledge = project ? await knowledgeFor(env, spec, project, memo) : null;
    const system = buildSystemPrompt({ spec, vars: { ...vars, modelName: spec.name, providerName: PROVIDER_NAMES[spec.provider] }, artifacts: body.artifacts !== false, search, personal, owner: settings.instructions, project: knowledge?.prompt ?? null, memory: memoryText });
    const messages = withKnowledge(await materialize(env, turns, spec, fileRows, memo), knowledge);
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

  // Pass-through (passthrough.ts): our own events, then the provider's bytes
  // untouched, then our closing events, all on one native stream so the bytes
  // in the middle cost no CPU here.
  const pipe = makePipe(() => gone());
  const out = pipe.writable;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = out.getWriter();
  let chain: Promise<void> = Promise.resolve();
  let open = true;
  /** Frames sent while the provider's bytes flow wait for the end. */
  let held: Uint8Array[] | null = null;
  const gone = (): void => { open = false; abort.abort(); };
  const write = (bytes: Uint8Array): void => {
    const w = writer;
    if (!w || !open) return;
    chain = chain.then(() => w.write(bytes)).catch(gone);
  };
  const send = (event: string, data: unknown): void => {
    if (!open) return;
    const frame = sseFrame(event, data);
    if (held) held.push(frame);
    else write(frame);
  };

  const pump = async (): Promise<void> => {
    const started = Date.now();
    let model = candidates[0];
    let text = '';
    let thinking = '';
    let thinkMs: number | null = null;
    let usage: { input: number; output: number } | null = null;
    let stop: StopReason = 'end';
    let markers: Marker[] = [];
    /** The reply's text is whole on this side, so this request saves it (the page keeps what it saw otherwise). */
    let complete = false;
    /** The reply ended but was too large to read again here: the page saves it (`saved: false`). */
    let tooBig = false;
    const metaOf = (m: ModelSpec) => ({ conversationId: conversation.id, userMessageId: userMsg.id, assistantMessageId: assistantId, model: modelInfo(m), wire: ADAPTERS[m.provider].wire, ...(continuing ? { continued: true } : {}) });
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
    const failed = (err: ProviderError, spec: ModelSpec | null, partial: boolean): void => {
      stop = 'error';
      const exhausted = mode === 'auto' && !partial && spec === null;
      send('error', {
        code: errorCode(err, exhausted),
        message: exhausted ? 'VinaX AI is busy right now. Try again in a moment.' : humanReason(err, spec),
        retryable: true,
        ...(mode === 'model' && !partial ? { alternatives: alternativesFor(model) } : {}),
      });
    };
    try {
      const started_ = await openModel(env, {
        candidates, picked: mode === 'model', build, signal: abort.signal,
        firstEventMs: firstEventMsFor(slow, mode === 'model' ? candidates[0] ?? null : null),
        budgetMs: slow ? REPLY_BUDGET_SLOW_MS : REPLY_BUDGET_MS,
      });
      if (!started_.ok) {
        if (!abort.signal.aborted) failed(started_.error, mode === 'auto' ? null : started_.spec, false);
      } else {
        const opened = started_.opened;
        if (opened.spec.id !== model.id) {
          model = opened.spec;
          send('meta', metaOf(model));
        }
        let broke = false;
        /** What a page without pass-through was sent (kept if the reply breaks off). */
        let relayed = { text: '', thinking: '' };
        if (!passthrough) {
          // An older page reads only named events: relay them one by one (the old, CPU-hungry way).
          try {
            for await (const ev of ADAPTERS[model.provider].parse(opened.live)) {
              if (!open) break;
              if (ev.type === 'thinking') { relayed.thinking += ev.delta; send('thinking', { delta: ev.delta }); }
              else if (ev.type === 'text') { relayed.text += ev.delta; send('text', { delta: ev.delta }); }
            }
          } catch {
            broke = true;
          }
          await chain;
          if (!open) opened.abort();
        } else {
          // Hand the provider's bytes over; frames from now on wait for the end.
          await chain;
          held = [];
          writer?.releaseLock();
          writer = null;
          if (open) {
            try {
              await opened.live.pipeTo(out, { preventClose: true, preventAbort: true });
            } catch {
              broke = true;
            }
          } else void opened.live.cancel().catch(() => undefined);
          // A page that went away (Stop) cancels the pipe: stop the model too.
          try { writer = out.getWriter(); } catch { gone(); }
          const later = held;
          held = null;
          write(enc.encode('\n\n'));
          for (const f of later) write(f);
          await chain;
          if (!open) opened.abort();
          relayed = { text: '', thinking: '' };
        }
        let raw: string | null = null;
        try { raw = await opened.whole(); } catch { raw = null; }
        opened.finish();
        if (raw === null) {
          // The reply broke off (time budget, network, Stop): the page keeps what it saw
          // (an older page cannot, so its relayed text is saved here).
          if (!abort.signal.aborted) failed(broke ? new ProviderError('network') : new ProviderError('timeout'), model, true);
          if (relayed.text.trim()) {
            ({ text, thinking } = relayed);
            complete = true;
          }
        } else if (passthrough && raw.length > PARSE_MAX_CHARS) {
          // Too big to read again within the CPU allowance: the page saves what it showed.
          stop = tailStop(raw);
          tooBig = true;
        } else {
          const parsed = await collect(ADAPTERS[model.provider].parse(textBody(raw)));
          for (const ev of parsed.events) {
            if (ev.type === 'thinking') thinking += ev.delta;
            else if (ev.type === 'text') text += ev.delta;
            else if (ev.type === 'usage') usage = { input: ev.input, output: ev.output };
            else if (ev.type === 'end') stop = ev.reason === 'length' ? 'length' : 'end';
            else if (ev.type === 'sources') {
              // Grounding: the sources arrive with the end of the answer.
              markers = placeMarkers(text, ev.supports ?? []);
              searched = { items: ev.items, via: 'grounding', queries: ev.queries, ...(ev.entryPointHtml ? { entryPointHtml: ev.entryPointHtml } : {}) };
              searchLog = { via: 'grounding', count: ev.items.length };
              send('status', { step: 'searched', count: ev.items.length, sites: sitesOf(ev.items) });
              send('sources', { ...searched, markers });
            }
          }
          if (parsed.error) {
            noteFailure(model, parsed.error);
            failed(parsed.error, model, text.trim().length > 0);
          }
          complete = true;
          // Time spent reasoning, shared out by length (the bytes passed by without a clock).
          if (thinking) thinkMs = Math.round((Date.now() - opened.firstAt) * (thinking.length / Math.max(1, thinking.length + text.length)));
        }
      }
    } catch {
      stop = 'error';
      send('error', { code: 'model_unavailable', message: 'VinaX AI couldn’t answer just now.', retryable: true });
    }
    if (abort.signal.aborted) stop = 'aborted';
    // Give the title a moment to arrive in this stream; it is saved whenever it comes.
    if (titleJob && open) await Promise.race([titleJob, new Promise((r) => setTimeout(r, TITLE_WAIT_MS))]);
    // The question was saved while the model answered; without it the reply has nowhere to hang.
    const userOk = await userSaved;
    if (!userOk && stop !== 'error' && !abort.signal.aborted) {
      stop = 'error';
      send('error', { code: 'model_unavailable', message: 'VinaX AI couldn’t save this chat just now. Try again.', retryable: true });
    }
    const savedReply = userOk && complete && (!abort.signal.aborted || !passthrough) && text.trim().length > 0;
    send('done', { stopReason: stop, saved: savedReply || (!!continuing && !tooBig), ...(usage ? { usage } : {}) });
    await chain;
    if (open) {
      open = false;
      try { await writer?.close(); } catch { /* the reader is gone */ }
    }

    // Save the reply and move the active leaf (a broken-off or stopped one is kept by the page: POST /api/ai/keep).
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
      ...(userOk ? { active_leaf_id: savedReply || continuing ? assistantId : userMsg.id } : {}),
      model_pref: mode === 'model' ? model.id : 'auto',
    });
    if (titleJob) await titleJob;
    console.log(JSON.stringify({ route: 'ai-chat', continued: !!continuing, search: searchLog, model: model.id, provider: model.provider, ladder, ms: Date.now() - started, status: stop, input: usage?.input ?? null, output: usage?.output ?? null }));
    // Memory: learn from this turn once the reply is saved (this whole job runs under waitUntil).
    if (learnNow && savedReply && (stop === 'end' || stop === 'length')) {
      const path = [...pathRows.map((r) => ({ role: r.role, text: typedText(r.content) })), { role: 'assistant' as const, text: finalText }];
      await learnFromChat(env, { accountId: sub, conversationId: conversation.id, candidates: learnCandidates(registry), items: memory.items, path });
    }
  };

  const job = pump().catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(job);
  return new Response(pipe.readable, { status: 200, headers: SSE_HEADERS });
};
