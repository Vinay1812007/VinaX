/**
 * VinaX AI — the open conversation's store and the send / retry / stop
 * controller. Text and reasoning deltas are applied once per animation
 * frame (a fast model sends hundreds a second); every other event is
 * applied at once, in order.
 */
import { create } from 'zustand';
import { queryClient } from '@/services/queryClient';
import { AiError, createImageTurn, imageNotice, keepReply, noticeFor, patchConversation, streamChat, type ChatRequestBody, type KeepBody } from './api';
import { chatReducer, initialChat, leafUnder, parentForNext, unansweredQuestion, type ChatAction, type ChatState } from './chatState';
import { personalOf, usePrefs } from './prefs';
import { parseArtifacts, mayHaveArtifacts } from './artifacts';
import { dropDraft, keepaliveBody, retryable, saveDraft, sendKeepalive } from './keepOnLeave';
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

/** The composer's Research switch (ChatView): on, the next messages ask for several searches and a report. */
let researchOn = false;
export const setResearch = (on: boolean): void => { researchOn = on; };
export const isResearchOn = (): boolean => researchOn;

function requestBase(choice?: ModelChoice): Pick<ChatRequestBody, 'mode' | 'model' | 'thinking' | 'webSearch' | 'research' | 'artifacts' | 'timezone' | 'locale' | 'personal' | 'incognito'> {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  const prefs = usePrefs.getState();
  const pick: ModelChoice = choice ?? (prefs.model === 'auto' ? { mode: 'auto' } : { mode: 'model', model: prefs.model });
  const personal = personalOf(prefs);
  const incognito = useChatStore.getState().incognito;
  return { ...pick, thinking: prefs.thinking, webSearch: prefs.webSearch, ...(researchOn ? { research: true } : {}), artifacts: prefs.artifacts, timezone, locale: typeof navigator !== 'undefined' ? navigator.language : 'en', ...(personal ? { personal } : {}), ...(incognito ? { incognito: true } : {}) };
}

/** `beforeStart`: nothing was saved, so the page puts the text back in the composer. */
export type RunOutcome = { ok: true } | { ok: false; code: string; beforeStart: boolean };

type Meta = Extract<StreamEvent, { event: 'meta' }>['data'];
type Done = Extract<StreamEvent, { event: 'done' }>['data'];

/** What the page shows of reply `meta`, as a keep request; null without answer text. */
function keepBodyOf(meta: Meta, stopReason: KeepBody['stopReason']): KeepBody | null {
  const reply = useChatStore.getState().messages[meta.assistantMessageId];
  if (!reply || !reply.text.trim()) return null;
  return {
    conversationId: meta.conversationId, userMessageId: meta.userMessageId, assistantMessageId: meta.assistantMessageId,
    text: reply.text, ...(reply.thinking ? { thinking: reply.thinking } : {}), model: meta.model.id, stopReason,
    ...(meta.continued ? { continued: true } : {}),
  };
}

/**
 * The Worker passes the model's bytes straight through, so a reply it did
 * not save is only whole here: one that did not end on its own (Stop, a
 * stream that broke off), or one too large for it to read again
 * (`done.saved: false`). The page saves what it showed (POST /api/ai/keep);
 * for a Continue, the whole reply (the saved part plus what followed).
 * Resolves true when it was saved.
 */
function keepSeen(meta: Meta | null, stopReason: KeepBody['stopReason']): Promise<boolean> {
  const body = meta ? keepBodyOf(meta, stopReason) : null;
  if (!body) return Promise.resolve(false);
  // Kept on the device too until the save gets through (the page may close first: keepOnLeave.ts).
  saveDraft(body);
  return keepReply(body).then((r) => { dropDraft(body.assistantMessageId); refreshList(); return r.saved === true; }).catch((e: unknown) => {
    if (!retryable(e)) dropDraft(body.assistantMessageId);
    return false;
  });
}

/** The reply being written right now, for a page that goes away in the middle of it. */
let writing: { meta: Meta | null; done: Done | null } | null = null;

/**
 * The page is closing (pagehide) or being frozen (freeze) while a reply is
 * written: send what it shows to the keep route with keepalive, and keep a
 * draft on the device for the next open (keepOnLeave.ts). A reply the
 * Worker saves itself (`done` without `saved: false`) needs neither.
 * Backgrounding is not leaving: a reply goes on in the background.
 */
export function keepOnLeave(): void {
  const w = writing;
  if (!w?.meta || (w.done && w.done.saved !== false)) return;
  flush();
  const body = keepBodyOf(w.meta, w.done ? w.done.stopReason : 'aborted');
  if (!body) return;
  saveDraft(body);
  const wire = keepaliveBody(body);
  if (wire) sendKeepalive('/keep', wire);
}

let watching = false;
function watchLeave(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pagehide', keepOnLeave);
  document.addEventListener('freeze', keepOnLeave);
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
  return mayHaveArtifacts(text) && parseArtifacts(text).some((seg) => seg.kind === 'artifact' && seg.artifact.incomplete);
};

async function run(body: ChatRequestBody, attempt = 0, autoLeft = AUTO_CONTINUES): Promise<RunOutcome> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  watchLeave();
  let meta: Meta | null = null;
  let done: Done | null = null;
  const seen: { meta: Meta | null; done: Done | null } = { meta: null, done: null };
  writing = seen;
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
    void keepSeen(m, 'error');
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
        if (ev.event === 'meta') meta = seen.meta = ev.data;
        if (ev.event === 'done') done = seen.done = ev.data;
        enqueue(ev);
      }, ctl.signal),
      stopped,
    ]);
    flush();
    const finished = done as Done | null;
    if (!finished) {
      if (meta) return await brokeOff('network');
      dispatch({ type: 'fail', code: 'network', message: noticeFor('network') });
      return { ok: false, code: 'network', beforeStart: true };
    }
    const m = meta as Meta | null;
    // Saved by the Worker (over any part kept when the page was frozen): no draft is needed.
    if (m && finished.saved !== false) dropDraft(m.assistantMessageId);
    // Not saved by the Worker: save it from here (and before a Continue, which needs it saved).
    const kept = finished.saved === false ? await keepSeen(m, finished.stopReason) : true;
    if (finished.stopReason === 'length' && kept && m && autoLeft > 0 && cutInsideArtifact(m.assistantMessageId)) {
      if (inflight === ctl) inflight = null;
      return continueFrom(m.assistantMessageId, autoLeft - 1);
    }
    return { ok: true };
  } catch (e) {
    flush();
    if (ctl.signal.aborted) {
      dispatch({ type: 'stopped' });
      if (meta && !done) void keepSeen(meta, 'aborted');
      return meta ? { ok: true } : { ok: false, code: 'aborted', beforeStart: true };
    }
    const code = e instanceof AiError ? e.code : 'network';
    if (meta) return await brokeOff(code);
    dispatch({ type: 'fail', code, message: noticeFor(code) });
    return { ok: false, code, beforeStart: true };
  } finally {
    if (inflight === ctl) inflight = null;
    if (writing === seen) writing = null;
  }
}

/**
 * Send a message. By default it follows the branch on screen; an edit passes
 * the edited message's parent (null for the first message), which makes the
 * new message its sibling. `choice` asks a particular model instead of the
 * composer's (Fix it asks the model that wrote the artifact).
 */
export function sendMessage(text: string, opts: { parentId?: string | null; files?: FileRef[]; projectId?: string | null; choice?: ModelChoice } = {}): Promise<RunOutcome> {
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
    ...requestBase(opts.choice),
    conversationId: s.conversationId,
    ...(projectId ? { projectId } : {}),
    ...(s.conversationId ? { parentMessageId: parent ?? 'root' } : {}),
    content: [...files.map((f) => ({ type: 'attachment' as const, id: f.id })), ...(text.trim() ? [{ type: 'text' as const, text }] : [])],
  });
}

/** What the listener's turn says for a Create image request (the Worker saves the same). */
export const IMAGE_REQUEST_PREFIX = 'Create an image: ';

/**
 * Create image: one picture from `prompt` (POST /api/ai/images), in the
 * open chat or a new one. The turn shows at once with a "Creating image…"
 * placeholder; Stop drops it here (the Worker may still finish and save it,
 * and it then shows when the chat is opened again).
 */
export async function createImage(prompt: string, opts: { projectId?: string | null; perDay?: number } = {}): Promise<RunOutcome> {
  const s = useChatStore.getState();
  const text = prompt.trim();
  if (s.streaming || !text) return { ok: true };
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  const parent = parentForNext(s);
  dispatch({ type: 'send', text: `${IMAGE_REQUEST_PREFIX}${text}`, parentId: parent, now: new Date().toISOString(), projectId: opts.projectId, image: true });
  const projectId = s.conversationId ? null : opts.projectId ?? null;
  try {
    const r = await createImageTurn({
      prompt: text,
      conversationId: s.conversationId,
      ...(s.conversationId ? { parentMessageId: parent ?? 'root' } : {}),
      ...(projectId ? { projectId } : {}),
      ...(s.incognito ? { incognito: true } : {}),
    }, ctl.signal);
    if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    dispatch({ type: 'image-done', conversation: r.conversation, user: r.userMessage, reply: r.assistantMessage });
    refreshList();
    return { ok: true };
  } catch (e) {
    if (ctl.signal.aborted) {
      // Stopped here (Stop, New chat): drop the placeholder. Replaced by a newer
      // request instead: that one owns the page now, so leave it alone.
      if (inflight === ctl) dispatch({ type: 'stopped' });
      return { ok: false, code: 'aborted', beforeStart: true };
    }
    const code = e instanceof AiError ? e.code : 'network';
    dispatch({ type: 'fail', code, message: imageNotice(code, opts.perDay) });
    return { ok: false, code, beforeStart: true };
  } finally {
    if (inflight === ctl) inflight = null;
  }
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
  researchOn = false;
  dispatch({ type: 'reset' });
}
