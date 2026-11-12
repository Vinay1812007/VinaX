/**
 * VinaX AI — the open conversation's store and the send / retry / stop
 * controller. Text and reasoning deltas are applied once per animation
 * frame (a fast model sends hundreds a second); every other event is
 * applied at once, in order.
 */
import { create } from 'zustand';
import { queryClient } from '@/services/queryClient';
import { AiError, keepReply, noticeFor, patchConversation, streamChat, type ChatRequestBody } from './api';
import { chatReducer, initialChat, leafUnder, parentForNext, unansweredQuestion, type ChatAction, type ChatState } from './chatState';
import { personalOf, usePrefs } from './prefs';
import { parseArtifacts } from './artifacts';
import type { FileRef, StreamEvent } from './types';

interface Store extends ChatState {
  dispatch(actions: ChatAction | ChatAction[]): void;
}

export const useChatStore = create<Store>()((set) => ({
  ...initialChat(),
  dispatch: (actions) => set((s) => (Array.isArray(actions) ? actions : [actions]).reduce(chatReducer, s as ChatState)),
}));

const dispatch = (a: ChatAction | ChatAction[]): void => useChatStore.getState().dispatch(a);

let inflight: AbortController | null = null;
let queue: ChatAction[] = [];
let frame: number | null = null;
const raf = (fn: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number));
const caf = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); };

function flush(): void {
  if (frame != null) caf(frame);
  frame = null;
  const batch = queue;
  queue = [];
  if (batch.length) dispatch(batch);
}

/** The conversation list changes when a chat is created, titled or answered. */
const refreshList = (): void => { void queryClient.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] }).catch(() => undefined); };

function enqueue(ev: StreamEvent): void {
  queue.push({ type: 'stream', ev, now: Date.now() });
  if (ev.event === 'title' || ev.event === 'done') queueMicrotask(refreshList);
  if (ev.event === 'text' || ev.event === 'thinking') {
    frame ??= raf(flush);
  } else flush();
}

/** Which model answers: the composer's choice, or an explicit one (Retry with…). */
export type ModelChoice = { mode: 'auto' } | { mode: 'model'; model: string };

function requestBase(choice?: ModelChoice): Pick<ChatRequestBody, 'mode' | 'model' | 'extendedThinking' | 'webSearch' | 'artifacts' | 'timezone' | 'locale' | 'personal' | 'incognito'> {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  const prefs = usePrefs.getState();
  const pick: ModelChoice = choice ?? (prefs.model === 'auto' ? { mode: 'auto' } : { mode: 'model', model: prefs.model });
  const personal = personalOf(prefs);
  const incognito = useChatStore.getState().incognito;
  return { ...pick, extendedThinking: prefs.extendedThinking, webSearch: prefs.webSearch, artifacts: prefs.artifacts, timezone, locale: typeof navigator !== 'undefined' ? navigator.language : 'en', ...(personal ? { personal } : {}), ...(incognito ? { incognito: true } : {}) };
}

/** `beforeStart`: nothing was saved, so the page puts the text back in the composer. */
export type RunOutcome = { ok: true } | { ok: false; code: string; beforeStart: boolean };

type Meta = Extract<StreamEvent, { event: 'meta' }>['data'];

/**
 * The Worker passes the model's bytes straight through, so a reply that did
 * not end on its own (Stop, a stream that broke off) is only whole here: the
 * page saves what it showed (POST /api/ai/keep). A Continue is left out (its
 * text joins a reply the server already has).
 */
function keepSeen(meta: Meta | null, stopReason: 'aborted' | 'error'): void {
  if (!meta || meta.continued) return;
  const reply = useChatStore.getState().messages[meta.assistantMessageId];
  if (!reply || !reply.text.trim()) return;
  void keepReply({
    conversationId: meta.conversationId, userMessageId: meta.userMessageId, assistantMessageId: meta.assistantMessageId,
    text: reply.text, ...(reply.thinking ? { thinking: reply.thinking } : {}), model: meta.model.id, stopReason,
  }).then(refreshList).catch(() => undefined);
}

/** No answer text arrived for this reply (only reasoning, or nothing). */
const noAnswerYet = (meta: Meta | null): boolean => {
  const reply = meta ? useChatStore.getState().messages[meta.assistantMessageId] : undefined;
  return !reply?.text.trim();
};

/**
 * A reply that stopped at the model's length limit in the middle of an
 * artifact (a page, app or chart) carries on by itself this many times, so
 * the artifact is finished instead of left half-written.
 */
export const AUTO_CONTINUES = 3;

/** The reply stopped inside an artifact that is still open. */
const cutInsideArtifact = (id: string): boolean => {
  const text = useChatStore.getState().messages[id]?.text ?? '';
  return text.includes('<artifact') && parseArtifacts(text).some((seg) => seg.kind === 'artifact' && seg.artifact.incomplete);
};

async function run(body: ChatRequestBody, attempt = 0, autoLeft = AUTO_CONTINUES): Promise<RunOutcome> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  let meta: Meta | null = null;
  let done: Extract<StreamEvent, { event: 'done' }>['data'] | null = null;
  const failAfterStart = (code: string): void => {
    enqueue({ event: 'error', data: { code, message: code === 'network' ? 'The connection dropped before the reply finished.' : noticeFor(code), retryable: true } });
    enqueue({ event: 'done', data: { stopReason: 'error' } });
  };
  /**
   * The stream broke off after it began. Before any answer text, ask once
   * more by itself (the same question, a fresh reply); otherwise show the
   * error and keep the text that arrived.
   */
  const brokeOff = (code: string): Promise<RunOutcome> | RunOutcome => {
    const m = meta;
    if (m && attempt === 0 && !body.continueFrom && noAnswerYet(m)) {
      dispatch({ type: 'stopped' });
      dispatch({ type: 'retry', userId: m.userMessageId, now: new Date().toISOString() });
      const again: ChatRequestBody = { ...body, conversationId: m.conversationId, parentMessageId: m.userMessageId, content: [] };
      delete again.projectId;
      if (inflight === ctl) inflight = null;
      return run(again, attempt + 1, autoLeft);
    }
    failAfterStart(code);
    keepSeen(m, 'error');
    return { ok: false, code, beforeStart: false };
  };
  // Stop must work at once, even while the request is still waiting for an
  // answer (a stalled network may never settle the aborted fetch).
  const stopped = new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
  stopped.catch(() => undefined);
  try {
    await Promise.race([
      streamChat(body, (ev) => {
        if (ctl.signal.aborted) return; // late events after Stop are ignored
        if (ev.event === 'meta') meta = ev.data;
        if (ev.event === 'done') done = ev.data;
        enqueue(ev);
      }, ctl.signal),
      stopped,
    ]);
    flush();
    const finished = done as Extract<StreamEvent, { event: 'done' }>['data'] | null;
    if (!finished) {
      if (meta) return await brokeOff('network');
      dispatch({ type: 'fail', code: 'network', message: noticeFor('network') });
      return { ok: false, code: 'network', beforeStart: true };
    }
    if (finished.saved === false) keepSeen(meta, finished.stopReason === 'aborted' ? 'aborted' : 'error');
    const m = meta as Meta | null;
    if (finished.stopReason === 'length' && finished.saved !== false && m && autoLeft > 0 && cutInsideArtifact(m.assistantMessageId)) {
      if (inflight === ctl) inflight = null;
      return continueFrom(m.assistantMessageId, autoLeft - 1);
    }
    return { ok: true };
  } catch (e) {
    flush();
    if (ctl.signal.aborted) {
      dispatch({ type: 'stopped' });
      if (meta && !done) keepSeen(meta, 'aborted');
      return meta ? { ok: true } : { ok: false, code: 'aborted', beforeStart: true };
    }
    const code = e instanceof AiError ? e.code : 'network';
    if (meta) return await brokeOff(code);
    dispatch({ type: 'fail', code, message: noticeFor(code) });
    return { ok: false, code, beforeStart: true };
  } finally {
    if (inflight === ctl) inflight = null;
  }
}

/**
 * Send a message. By default it follows the branch on screen; an edit passes
 * the edited message's parent (null for the first message), which makes the
 * new message its sibling.
 */
export function sendMessage(text: string, opts: { parentId?: string | null; files?: FileRef[]; projectId?: string | null } = {}): Promise<RunOutcome> {
  const s = useChatStore.getState();
  const files = opts.files ?? [];
  if (s.streaming || (!text.trim() && !files.length)) return Promise.resolve({ ok: true });
  // The same question again right after it went unanswered: a new answer to it, not a second copy.
  const unanswered = opts.parentId === undefined && !files.length ? unansweredQuestion(s) : null;
  if (unanswered && unanswered.text.trim() === text.trim()) return retryReply(unanswered.id);
  const parent = opts.parentId !== undefined ? opts.parentId : parentForNext(s);
  dispatch({ type: 'send', text, parentId: parent, now: new Date().toISOString(), files, projectId: opts.projectId });
  // A new chat starts in the project it was sent from.
  const projectId = s.conversationId ? null : opts.projectId ?? null;
  return run({
    ...requestBase(),
    conversationId: s.conversationId,
    ...(projectId ? { projectId } : {}),
    ...(s.conversationId ? { parentMessageId: parent ?? 'root' } : {}),
    content: [...files.map((f) => ({ type: 'attachment' as const, id: f.id })), ...(text.trim() ? [{ type: 'text' as const, text }] : [])],
  });
}

/** A new answer to the question `userId`, from the composer's model or `choice`. */
export function retryReply(userId: string, choice?: ModelChoice): Promise<RunOutcome> {
  const s = useChatStore.getState();
  if (s.streaming || !s.conversationId) return Promise.resolve({ ok: true });
  dispatch({ type: 'retry', userId, now: new Date().toISOString() });
  return run({ ...requestBase(choice), conversationId: s.conversationId, parentMessageId: userId, content: [] });
}

/** Carry on a reply that was cut off; the new text joins it. */
export function continueReply(messageId: string): Promise<RunOutcome> {
  return continueFrom(messageId, AUTO_CONTINUES);
}

function continueFrom(messageId: string, autoLeft: number): Promise<RunOutcome> {
  const s = useChatStore.getState();
  if (s.streaming || !s.conversationId || !s.messages[messageId]) return Promise.resolve({ ok: true });
  dispatch({ type: 'continue', messageId });
  return run({ ...requestBase(), conversationId: s.conversationId, continueFrom: messageId, content: [] }, 0, autoLeft);
}

/** Show the branch through `messageId` (the ‹ 2 / 3 › switcher) and remember it for the next visit. */
export function selectBranch(messageId: string): void {
  const s = useChatStore.getState();
  if (s.streaming || !s.messages[messageId]) return;
  const leaf = leafUnder(s.messages, messageId);
  dispatch({ type: 'select-leaf', leafId: leaf });
  if (s.conversationId && !s.messages[leaf].local) void patchConversation(s.conversationId, { activeLeafId: leaf }).catch(() => undefined);
}

/** Stop the reply being written (what was written so far is kept: keepSeen). */
export function stopReply(): void {
  inflight?.abort();
}

/** Start the new chat incognito (or not); only before its first message. */
export function setIncognito(on: boolean): void {
  dispatch({ type: 'incognito', on });
}

export function resetChat(): void {
  inflight?.abort();
  queue = [];
  dispatch({ type: 'reset' });
}
