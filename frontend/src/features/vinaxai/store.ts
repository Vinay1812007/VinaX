/**
 * VinaX AI — the open conversation's store and the send / retry / stop
 * controller. Text and reasoning deltas are applied once per animation
 * frame (a fast model sends hundreds a second); every other event is
 * applied at once, in order.
 */
import { create } from 'zustand';
import { AiError, noticeFor, streamChat, type ChatRequestBody } from './api';
import { chatReducer, initialChat, parentForNext, type ChatAction, type ChatState } from './chatState';
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

function enqueue(ev: StreamEvent): void {
  queue.push({ type: 'stream', ev, now: Date.now() });
  if (ev.event === 'text' || ev.event === 'thinking') {
    frame ??= raf(flush);
  } else flush();
}

function requestBase(): Pick<ChatRequestBody, 'mode' | 'timezone' | 'locale'> {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  return { mode: 'auto', timezone, locale: typeof navigator !== 'undefined' ? navigator.language : 'en' };
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

/** Send a new message after the branch on screen. */
export function sendMessage(text: string): Promise<RunOutcome> {
  const s = useChatStore.getState();
  if (s.streaming || !text.trim()) return Promise.resolve({ ok: true });
  const parent = parentForNext(s);
  dispatch({ type: 'send', text, parentId: parent, now: new Date().toISOString() });
  return run({
    ...requestBase(),
    conversationId: s.conversationId,
    ...(s.conversationId ? { parentMessageId: parent ?? 'root' } : {}),
    content: [{ type: 'text', text }],
  });
}

/** A new answer to the question `userId`. */
export function retryReply(userId: string): Promise<RunOutcome> {
  const s = useChatStore.getState();
  if (s.streaming || !s.conversationId) return Promise.resolve({ ok: true });
  dispatch({ type: 'retry', userId, now: new Date().toISOString() });
  return run({ ...requestBase(), conversationId: s.conversationId, parentMessageId: userId, content: [] });
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
