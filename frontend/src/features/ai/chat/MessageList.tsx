import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PinIcon } from '@/components/ai/AiExtras';
import { scrollBehavior } from '@/utils/motion';
import { AssistantMessage, UserMessage, type MessageHandlers } from './Message';
import type { Msg } from './types';

/** How many messages a chat opens with, and how many "Show earlier" adds. A
 *  300-message thread costs the same to open as a 40-message one. */
export const MESSAGE_WINDOW = 40;

/** First index to render for a thread of `length` when it is opened. */
export const windowStart = (length: number, size = MESSAGE_WINDOW): number => Math.max(0, length - size);

export interface MessageListProps {
  chatId: string;
  messages: Msg[];
  busy: boolean;
  speakingId: string | null;
  /** Agent mode is on for the turn in flight. */
  agent: boolean;
  handlers: MessageHandlers;
  /**
   * 9.1.0 — called once with the list's own "jump to message i" function, so
   * another part of the page (the artifact panel's "Show in chat") can reach a
   * message that is OUTSIDE the rendered window: `goTo` widens the window first
   * and scrolls after the render, which a bare `getElementById` cannot do.
   */
  onReady?: (goTo: (index: number) => void) => void;
}

/**
 * The conversation column. Rows are memoised and the handlers object is
 * stable, so while a reply streams only the row being written re-renders.
 * Long threads open on their most recent window; older messages are one tap
 * away and are never mounted until asked for. Mount with `key={chatId}` so
 * the window resets per chat.
 */
export function MessageList({ chatId, messages, busy, speakingId, agent, handlers, onReady }: MessageListProps): ReactNode {
  // Fixed when the chat opens: the window never slides forward under the
  // reader, it only grows — backwards on request, forwards as replies arrive.
  const [start, setStart] = useState(() => windowStart(messages.length));
  const from = Math.min(start, Math.max(0, messages.length - 1));
  const jumpTo = useRef<number | null>(null);

  useEffect(() => {
    if (jumpTo.current === null) return;
    const i = jumpTo.current;
    jumpTo.current = null;
    document.getElementById(`ai-msg-${i}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }, [start]);

  const goTo = (i: number): void => {
    if (i < from) {
      jumpTo.current = i;
      setStart(i);
      return;
    }
    document.getElementById(`ai-msg-${i}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  };

  // Hand `goTo` up once; the identity changes per render, so a ref keeps the
  // published function current without re-running the effect.
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  useEffect(() => {
    onReady?.((i) => goToRef.current(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- published once per mount
  }, []);

  const pinned = messages.map((m, i) => ({ m, i })).filter((x) => x.m.pinned);
  const lastIndex = messages.length - 1;

  return (
    <div className="ai-column ai-thread">
      {pinned.length > 0 && (
        <div className="ai-card ai-pinned" role="group" aria-label="Pinned replies">
          <p className="ai-card-heading">
            <PinIcon className="w-3.5 h-3.5" /> Pinned
          </p>
          {pinned.map(({ m, i }) => (
            // Truncated by CSS, never by slicing: a cut can split an Indic syllable.
            <button key={i} type="button" onClick={() => goTo(i)} className="block w-full text-left truncate py-1 ai-t2 hover:ai-t1">
              {m.content.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ')}
            </button>
          ))}
        </div>
      )}
      {from > 0 && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setStart((s) => Math.max(0, Math.min(s, from) - MESSAGE_WINDOW))} className="ai-chip">
            Show earlier messages ({from})
          </button>
        </div>
      )}
      {messages.slice(from).map((m, k) => {
        const i = from + k;
        const last = i === lastIndex;
        if (m.role === 'user') return <UserMessage key={i} m={m} index={i} busy={busy} handlers={handlers} />;
        const speakKey = `${chatId}:${i}`;
        return (
          <AssistantMessage
            key={i}
            m={m}
            index={i}
            last={last}
            streaming={busy && last}
            busy={busy}
            speaking={speakingId === speakKey}
            speakKey={speakKey}
            agent={agent && busy && last}
            handlers={handlers}
          />
        );
      })}
    </div>
  );
}
