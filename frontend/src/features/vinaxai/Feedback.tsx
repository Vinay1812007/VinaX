/**
 * VinaX AI — thumbs up and down under a reply. A second press on the same
 * thumb takes the rating back. A thumbs down opens a short "What went
 * wrong?" with four reasons and an optional note (at most 300 characters).
 * The rating shows at once and is saved in the background
 * (POST /api/ai/feedback); if saving fails it goes back to what it was.
 * The owner sees each model's share of thumbs up in the console.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { sendFeedback } from './api';
import { useChatStore } from './store';
import { ThumbDownIcon, ThumbUpIcon } from './icons';
import type { ChatMessage, FeedbackReason, MessageFeedback } from './types';

export const NOTE_MAX = 300;
export const REASONS: ReadonlyArray<{ value: FeedbackReason; label: string }> = [
  { value: 'wrong', label: 'Wrong' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'too_slow', label: 'Too slow' },
  { value: 'other', label: 'Other' },
];

/** What a press on a thumb makes the rating: the same thumb again takes it back. */
export function nextRating(current: MessageFeedback | null | undefined, pressed: 'up' | 'down'): MessageFeedback | null {
  return current?.rating === pressed ? null : { rating: pressed };
}

const shownFor = (messageId: string): MessageFeedback | null => useChatStore.getState().messages[messageId]?.feedback ?? null;

/**
 * Show `next` now and save it; on failure the reply goes back to `before`.
 * Resolves true when it was saved.
 */
export async function rateReply(conversationId: string, messageId: string, next: MessageFeedback | null, before: MessageFeedback | null): Promise<boolean> {
  const { dispatch } = useChatStore.getState();
  dispatch({ type: 'feedback', messageId, feedback: next });
  try {
    const r = await sendFeedback({ conversationId, messageId, rating: next?.rating ?? null, ...(next?.reason ? { reason: next.reason } : {}), ...(next?.note ? { note: next.note } : {}) });
    // The server's copy, unless a newer press is already showing (its own answer follows).
    if (shownFor(messageId) === next) dispatch({ type: 'feedback', messageId, feedback: r.feedback ?? null });
    return true;
  } catch {
    // Only undo if nothing newer was chosen meanwhile.
    if (shownFor(messageId) === next) dispatch({ type: 'feedback', messageId, feedback: before });
    return false;
  }
}

/**
 * The thumbs for one reply: `buttons` go in the reply's action row, `panel`
 * (the "What went wrong?" after a thumbs down, or a short status) right
 * below it. Both are null for a reply that is not saved yet.
 */
export function useReplyFeedback(message: ChatMessage): { buttons: ReactNode; panel: ReactNode } {
  const conversationId = useChatStore((s) => s.conversationId);
  const current = message.feedback ?? null;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState('');
  const [said, setSaid] = useState<'thanks' | 'failed' | null>(null);
  const id = useId();
  useEffect(() => {
    if (said !== 'thanks') return;
    const t = setTimeout(() => setSaid(null), 4_000);
    return () => clearTimeout(t);
  }, [said]);
  if (!conversationId || message.local) return { buttons: null, panel: null };

  const press = (pressed: 'up' | 'down') => {
    const next = nextRating(current, pressed);
    setSaid(null);
    setAsking(next?.rating === 'down');
    setReason(null);
    setNote('');
    void rateReply(conversationId, message.id, next, current).then((ok) => {
      if (!ok) { setAsking(false); setSaid('failed'); } else if (next?.rating === 'up') setSaid('thanks');
    });
  };
  const sendWhy = () => {
    const next: MessageFeedback = { rating: 'down', ...(reason ? { reason } : {}), ...(note.trim() ? { note: note.trim().slice(0, NOTE_MAX) } : {}) };
    setAsking(false);
    void rateReply(conversationId, message.id, next, current).then((ok) => setSaid(ok ? 'thanks' : 'failed'));
  };
  const up = current?.rating === 'up';
  const down = current?.rating === 'down';

  const buttons = (
    <>
      <button type="button" className={`vx-ai-act${up ? ' is-on' : ''}`} onClick={() => press('up')} aria-label="Good reply" aria-pressed={up} title="Good reply">
        <ThumbUpIcon className="w-4 h-4" filled={up} />
      </button>
      <button
        type="button"
        className={`vx-ai-act${down ? ' is-on' : ''}`}
        onClick={() => press('down')}
        aria-label="Bad reply"
        aria-pressed={down}
        aria-expanded={down ? asking : undefined}
        aria-controls={asking ? `${id}-why` : undefined}
        title="Bad reply"
      >
        <ThumbDownIcon className="w-4 h-4" filled={down} />
      </button>
    </>
  );
  const panel = asking ? (
    <div id={`${id}-why`} className="vx-ai-fb" role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`} className="vx-ai-fb-q">What went wrong?</p>
      <div className="vx-ai-fb-reasons">
        {REASONS.map((r) => (
          <button key={r.value} type="button" className={`vx-ai-chip${reason === r.value ? ' is-primary' : ''}`} aria-pressed={reason === r.value} onClick={() => setReason(reason === r.value ? null : r.value)}>
            {r.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${id}-note`}>Tell us more (optional)</label>
      <textarea
        id={`${id}-note`}
        value={note}
        maxLength={NOTE_MAX}
        rows={2}
        placeholder="Tell us more (optional)"
        onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAsking(false); } }}
      />
      <div className="vx-ai-fb-row">
        <span className="vx-ai-fb-count" aria-hidden>{note.length} / {NOTE_MAX}</span>
        <button type="button" className="vx-ai-chip" onClick={() => setAsking(false)}>Skip</button>
        <button type="button" className="vx-ai-chip is-primary" onClick={sendWhy} disabled={!reason && !note.trim()}>Send</button>
      </div>
    </div>
  ) : said ? (
    <p className="vx-ai-fb-said" role="status">{said === 'thanks' ? 'Thanks for telling us.' : 'Couldn’t save that. Try again.'}</p>
  ) : null;
  return { buttons, panel };
}
