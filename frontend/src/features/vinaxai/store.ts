/**
 * VinaX AI — the open conversation's store and the send / retry / stop
 * controller. Text and reasoning deltas are applied once per animation
 * frame (a fast model sends hundreds a second); every other event is
 * applied at once, in order.
 */
import { create } from 'zustand';
import { queryClient } from '@/services/queryClient';
import { AiError, noticeFor, patchConversation, streamChat, type ChatRequestBody } from './api';
import { chatReducer, initialChat, leafUnder, parentForNext, type ChatAction, type ChatState } from './chatState';
import { usePrefs } from './prefs';
import type { StreamEvent } from './types';

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

function requestBase(choice?: ModelChoice): Pick<ChatRequestBody, 'mode' | 'model' | 'extendedThinking' | 'webSearch' | 'timezone' | 'locale'> {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  const prefs = usePrefs.getState();
  const pick: ModelChoice = choice ?? (prefs.model === 'auto' ? { mode: 'auto' } : { mode: 'model', model: prefs.model });
  return { ...pick, extendedThinking: prefs.extendedThinking, webSearch: prefs.webSearch, timezone, locale: typeof navigator !== 'undefined' ? navigator.language : 'en' };
}

/** `beforeStart`: nothing was saved, so the page puts the text back in the composer. */
export type RunOutcome = { ok: true } | { ok: false; code: string; beforeStart: boolean };

async function run(body: ChatRequestBody): Promise<RunOutcome> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  let sawMeta = false;
  let sawDone = false;
  const failAfterStart = (code: string): void => {
    enqueue({ event: 'error', data: { code, message: code === 'network' ? 'The connection dropped before the reply finished.' : noticeFor(code), retryable: true } });
    enqueue({ event: 'done', data: { stopReason: 'error' } });
  };
  // Stop must work at once, even while the request is still waiting for an
  // answer (a stalled network may never settle the aborted fetch).
  const stopped = new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
  stopped.catch(() => undefined);
  try {
    await Promise.race([
      streamChat(body, (ev) => {
        if (ctl.signal.aborted) return; // late events after Stop are ignored
        if (ev.event === 'meta') sawMeta = true;
        if (ev.event === 'done') sawDone = true;
        enqueue(ev);
      }, ctl.signal),
      stopped,
    ]);
    flush();
    if (!sawDone) {
      if (sawMeta) failAfterStart('network');
      else dispatch({ type: 'fail', code: 'network', message: noticeFor('network') });
      return { ok: false, code: 'network', beforeStart: !sawMeta };
    }
    return { ok: true };
  } catch (e) {
    flush();
    if (ctl.signal.aborted) {
      dispatch({ type: 'stopped' });
      return sawMeta ? { ok: true } : { ok: false, code: 'aborted', beforeStart: true };
    }
    const code = e instanceof AiError ? e.code : 'network';
    if (sawMeta) failAfterStart(code);
    else dispatch({ type: 'fail', code, message: noticeFor(code) });
    return { ok: false, code, beforeStart: !sawMeta };
  } finally {
    if (inflight === ctl) inflight = null;
  }
}

/**
 * Send a message. By default it follows the branch on screen; an edit passes
 * the edited message's parent (null for the first message), which makes the
 * new message its sibling.
 */
export function sendMessage(text: string, opts: { parentId?: string | null } = {}): Promise<RunOutcome> {
  const s = useChatStore.getState();
  if (s.streaming || !text.trim()) return Promise.resolve({ ok: true });
  const parent = opts.parentId !== undefined ? opts.parentId : parentForNext(s);
  dispatch({ type: 'send', text, parentId: parent, now: new Date().toISOString() });
  return run({
    ...requestBase(),
    conversationId: s.conversationId,
    ...(s.conversationId ? { parentMessageId: parent ?? 'root' } : {}),
    content: [{ type: 'text', text }],
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
  const s = useChatStore.getState();
  if (s.streaming || !s.conversationId || !s.messages[messageId]) return Promise.resolve({ ok: true });
  dispatch({ type: 'continue', messageId });
  return run({ ...requestBase(), conversationId: s.conversationId, continueFrom: messageId, content: [] });
}

/** Show the branch through `messageId` (the ‹ 2 / 3 › switcher) and remember it for the next visit. */
export function selectBranch(messageId: string): void {
  const s = useChatStore.getState();
  if (s.streaming || !s.messages[messageId]) return;
  const leaf = leafUnder(s.messages, messageId);
  dispatch({ type: 'select-leaf', leafId: leaf });
  if (s.conversationId && !s.messages[leaf].local) void patchConversation(s.conversationId, { activeLeafId: leaf }).catch(() => undefined);
}

/** Stop the reply being written (the server keeps what was written so far). */
export function stopReply(): void {
  inflight?.abort();
}

export function resetChat(): void {
  inflight?.abort();
  queue = [];
  dispatch({ type: 'reset' });
}
