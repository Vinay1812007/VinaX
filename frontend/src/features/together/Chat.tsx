import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTogether } from '@/services/together/session';
import { toast } from '@/store/toastStore';
import { openChat, say, sentLines, typing } from './engine';
import { chatRows, typingText, useRoom } from './room';

const clock = (at: number | null): string => (at === null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

/**
 * 1.13 — the room's chat, rebuilt. A line used to appear only when the next
 * poll brought it back (up to four seconds, for the sender too) and each new
 * line scrolled the whole page. Now a line is on the sender's screen as it is
 * sent and on everyone else's a moment later (the live line); the room shows
 * who is typing; each person's lines are bubbles, yours on the right; and only
 * the chat itself scrolls, and only when you are already at its end.
 */
export function Chat({ compact = false }: { compact?: boolean } = {}): ReactNode {
  const headingId = useId();
  const messages = useTogether((s) => s.messages);
  const extra = useRoom((s) => s.extra);
  const typers = useRoom((s) => s.typing);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLUListElement>(null);
  /** True while the listener is reading the end of the chat (not scrolled up into it). */
  const atEnd = useRef(true);
  const rows = useMemo(() => chatRows(messages, extra, sentLines()), [messages, extra]);
  const who = typingText(typers);

  // 1.14 — while the chat is on screen nothing is unread.
  useEffect(() => openChat(), []);

  useEffect(() => {
    const el = list.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, who]);

  const send = (): void => {
    const words = draft.trim();
    if (!words) return;
    setDraft('');
    atEnd.current = true;
    void say(words).then((ok) => {
      if (!ok) toast('Could not send that — tap the message to try again');
    });
  };

  return (
    <section className={compact ? 'vx-lt-block is-compact' : 'vx-lt-block'} aria-labelledby={headingId}>
      <h2 id={headingId} className="vx-lt-h2">Chat</h2>
      <div className="vx-lt-chatbox">
        <ul
          ref={list}
          className="vx-lt-chat"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {rows.length === 0 && <li className="vx-lt-chat-empty">Say hello — everyone in the room sees it.</li>}
          {rows.map((r, i) => {
            const last = !rows[i + 1]?.joined;
            return (
              <li key={r.key} className="vx-lt-msg" data-mine={r.mine ? 'true' : undefined} data-joined={r.joined ? 'true' : undefined} data-state={r.state}>
                {!r.mine && !r.joined && <span className="vx-lt-msg-by">{r.by}</span>}
                <span className="vx-lt-bubble">{r.text}</span>
                {r.state === 'failed' ? (
                  <button type="button" className="vx-lt-msg-retry" onClick={() => void say(r.text, r.key)}>
                    Not sent · Tap to try again
                  </button>
                ) : (
                  last && <span className="vx-lt-msg-meta">{r.state === 'sending' ? 'Sending…' : clock(r.at)}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="vx-lt-typing" role="status" data-on={who ? 'true' : undefined}>
          {who && (
            <>
              <span className="vx-lt-typing-dots" aria-hidden><i /><i /><i /></span>
              {who}
            </>
          )}
        </p>
        <form
          className="vx-lt-chat-form"
          data-tour="lt-chat"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              typing(e.target.value.trim().length > 0);
            }}
            onBlur={() => typing(false)}
            maxLength={200}
            placeholder="Say something"
            aria-label="Chat message"
            autoComplete="off"
            enterKeyHint="send"
            className="vx-lt-code-input is-chat"
          />
          <button type="submit" className="vx-lt-send" disabled={!draft.trim()}>Send</button>
        </form>
      </div>
    </section>
  );
}
