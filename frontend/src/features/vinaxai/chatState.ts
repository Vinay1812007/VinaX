/**
 * VinaX AI — the open conversation as a message tree, and the one reducer
 * every change goes through: the listener's own actions (send, retry, stop)
 * and each event of the reply stream. Pure, so it is tested directly
 * (chatState.test.ts); the Zustand store in store.ts only holds it.
 */
import type { ChatMessage, ServerConversation, ServerMessage, StreamEvent } from './types';

/** Ids for the two messages that exist only here until the stream's meta event names them. */
export const LOCAL_USER = 'local-user';
export const LOCAL_REPLY = 'local-reply';

export interface ChatState {
  conversationId: string | null;
  title: string | null;
  messages: Record<string, ChatMessage>;
  /** The branch on screen ends here. */
  leafId: string | null;
  streaming: boolean;
  /** The assistant message being written. */
  replyId: string | null;
  thinkingStartedAt: number | null;
  /** A failure before any reply started (unavailable, signed out, offline…). */
  notice: { code: string; message: string } | null;
  /** Counts finished replies; the live region announces on each change. */
  finished: number;
}

export type ChatAction =
  | { type: 'reset' }
  | { type: 'load'; conversation: ServerConversation; messages: ServerMessage[] }
  | { type: 'send'; text: string; parentId: string | null; now: string }
  | { type: 'retry'; userId: string; now: string }
  | { type: 'stream'; ev: StreamEvent; now: number }
  | { type: 'stopped' }
  | { type: 'fail'; code: string; message: string }
  | { type: 'dismiss' };

export const initialChat = (): ChatState => ({
  conversationId: null, title: null, messages: {}, leafId: null, streaming: false, replyId: null, thinkingStartedAt: null, notice: null, finished: 0,
});

const blank = (id: string, parentId: string | null, role: 'user' | 'assistant', text: string, now: string): ChatMessage => ({
  id, parentId, role, text, thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: now, local: true,
});

/** The branch root → leaf. */
export function pathTo(messages: Record<string, ChatMessage>, leafId: string | null): ChatMessage[] {
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  let cur = leafId ? messages[leafId] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? messages[cur.parentId] : undefined;
  }
  return out.reverse();
}

/** The newest message with no children. */
export function latestLeaf(messages: Record<string, ChatMessage>): string | null {
  const parents = new Set(Object.values(messages).map((m) => m.parentId));
  let best: ChatMessage | null = null;
  for (const m of Object.values(messages)) if (!parents.has(m.id) && (!best || m.createdAt >= best.createdAt)) best = m;
  return best?.id ?? null;
}

/** Where a new message should hang: after the leaf, skipping a failed reply that was never saved. */
export function parentForNext(state: ChatState): string | null {
  const leaf = state.leafId ? state.messages[state.leafId] : null;
  if (leaf?.local && leaf.role === 'assistant') return leaf.parentId;
  return leaf?.id ?? null;
}

function rename(messages: Record<string, ChatMessage>, from: string, to: string): Record<string, ChatMessage> {
  if (from === to || !messages[from]) return messages;
  const out: Record<string, ChatMessage> = {};
  for (const [id, m] of Object.entries(messages)) {
    const next = m.parentId === from ? { ...m, parentId: to } : m;
    if (id === from) out[to] = { ...next, id: to, local: false };
    else out[id] = next;
  }
  return out;
}

function without(messages: Record<string, ChatMessage>, drop: (m: ChatMessage) => boolean): Record<string, ChatMessage> {
  const out: Record<string, ChatMessage> = {};
  for (const [id, m] of Object.entries(messages)) if (!drop(m)) out[id] = m;
  return out;
}

const dropFailedLocals = (messages: Record<string, ChatMessage>) => without(messages, (m) => !!m.local && m.role === 'assistant' && !m.text);

function patchReply(state: ChatState, fn: (m: ChatMessage) => Partial<ChatMessage>): ChatState {
  const id = state.replyId;
  const m = id ? state.messages[id] : undefined;
  if (!id || !m) return state;
  return { ...state, messages: { ...state.messages, [id]: { ...m, ...fn(m) } } };
}

/** The reply ended: tidy up a reply that never got any text. */
function finish(state: ChatState): ChatState {
  const reply = state.replyId ? state.messages[state.replyId] : undefined;
  const next: ChatState = { ...state, streaming: false, thinkingStartedAt: null, finished: state.finished + 1 };
  if (reply && !reply.text.trim() && !reply.error) {
    if (reply.stopReason === 'aborted' || reply.stopReason === null) {
      // Stopped before anything arrived: nothing to keep.
      return { ...next, messages: without(state.messages, (m) => m.id === reply.id), leafId: reply.parentId, replyId: null };
    }
    return { ...next, messages: { ...state.messages, [reply.id]: { ...reply, local: true, error: { code: 'empty_reply', message: 'VinaX AI didn’t send an answer.', retryable: true } } } };
  }
  return next;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset':
      return initialChat();

    case 'dismiss':
      return { ...state, notice: null };

    case 'load': {
      const messages: Record<string, ChatMessage> = {};
      for (const m of action.messages) {
        messages[m.id] = {
          id: m.id, parentId: m.parentId, role: m.role,
          text: m.content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n\n'),
          thinking: m.thinking ?? '', thinkingMs: m.thinkingMs, model: m.model, stopReason: m.stopReason, error: null, createdAt: m.createdAt,
        };
      }
      const leaf = action.conversation.activeLeafId && messages[action.conversation.activeLeafId] ? action.conversation.activeLeafId : latestLeaf(messages);
      return { ...initialChat(), conversationId: action.conversation.id, title: action.conversation.title, messages, leafId: leaf, finished: state.finished };
    }

    case 'send': {
      if (state.streaming) return state;
      const base = dropFailedLocals(state.messages);
      const user = blank(LOCAL_USER, action.parentId, 'user', action.text, action.now);
      const reply = blank(LOCAL_REPLY, LOCAL_USER, 'assistant', '', action.now);
      return { ...state, notice: null, messages: { ...base, [LOCAL_USER]: user, [LOCAL_REPLY]: reply }, leafId: LOCAL_REPLY, replyId: LOCAL_REPLY, streaming: true, thinkingStartedAt: null };
    }

    case 'retry': {
      if (state.streaming || !state.messages[action.userId]) return state;
      const base = without(state.messages, (m) => !!m.local && m.role === 'assistant' && m.parentId === action.userId);
      const reply = blank(LOCAL_REPLY, action.userId, 'assistant', '', action.now);
      return { ...state, notice: null, messages: { ...base, [LOCAL_REPLY]: reply }, leafId: LOCAL_REPLY, replyId: LOCAL_REPLY, streaming: true, thinkingStartedAt: null };
    }

    case 'stopped': {
      if (!state.streaming) return state;
      // Stopped before the server named the messages: as if it was never sent
      // (the page puts the text back in the composer).
      if (state.replyId === LOCAL_REPLY) {
        const user = state.messages[LOCAL_USER];
        const leaf = user ? user.parentId : state.messages[LOCAL_REPLY]?.parentId ?? null;
        const messages = without(state.messages, (m) => m.id === LOCAL_USER || m.id === LOCAL_REPLY);
        return { ...state, messages, leafId: leaf && messages[leaf] ? leaf : null, streaming: false, replyId: null, thinkingStartedAt: null };
      }
      return finish(patchReply(state, (m) => ({ stopReason: m.stopReason ?? 'aborted' })));
    }

    case 'fail': {
      // The request failed before the stream began: undo the optimistic messages.
      const user = state.messages[LOCAL_USER];
      const reply = state.replyId ? state.messages[state.replyId] : undefined;
      const leaf = user ? user.parentId : reply?.parentId ?? state.leafId;
      const messages = without(state.messages, (m) => m.id === LOCAL_USER || m.id === LOCAL_REPLY);
      return { ...state, messages, leafId: leaf && messages[leaf] ? leaf : null, streaming: false, replyId: null, thinkingStartedAt: null, notice: { code: action.code, message: action.message } };
    }

    case 'stream': {
      const ev = action.ev;
      switch (ev.event) {
        case 'meta': {
          const { conversationId, userMessageId, assistantMessageId, model } = ev.data;
          let messages = rename(state.messages, LOCAL_USER, userMessageId);
          let replyId = state.replyId;
          if (replyId === LOCAL_REPLY) {
            messages = rename(messages, LOCAL_REPLY, assistantMessageId);
            replyId = assistantMessageId;
            messages[replyId] = { ...messages[replyId], local: true };
          }
          let thinkingStartedAt = state.thinkingStartedAt;
          const reply = replyId ? messages[replyId] : undefined;
          if (reply) {
            // A failover changed the model: what the first one was thinking no longer applies.
            const switched = !!reply.model && reply.model.id !== model.id;
            if (switched) thinkingStartedAt = null;
            messages = { ...messages, [reply.id]: { ...reply, model, ...(switched ? { thinking: '', thinkingMs: null } : {}) } };
          }
          return { ...state, conversationId, messages, replyId, leafId: state.leafId === LOCAL_REPLY ? replyId : state.leafId, thinkingStartedAt };
        }
        case 'title':
          return { ...state, title: ev.data.title };
        case 'thinking': {
          const s = patchReply(state, (m) => ({ thinking: m.thinking + ev.data.delta }));
          return { ...s, thinkingStartedAt: state.thinkingStartedAt ?? action.now };
        }
        case 'text':
          return patchReply(state, (m) => ({
            text: m.text + ev.data.delta,
            thinkingMs: m.thinkingMs ?? (state.thinkingStartedAt != null ? action.now - state.thinkingStartedAt : null),
          }));
        case 'error':
          return patchReply(state, () => ({ error: ev.data }));
        case 'done': {
          const s = patchReply(state, (m) => ({ stopReason: ev.data.stopReason, local: m.local && !m.text.trim() }));
          return finish(s);
        }
        default:
          return state;
      }
    }
  }
}
