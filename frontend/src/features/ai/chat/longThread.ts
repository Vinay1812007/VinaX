import type { Msg } from './types';

/**
 * 9.1.0 — keeping a long conversation inside the provider's context window
 * without silently forgetting its beginning.
 *
 * What happened before: the client sent the whole thread and the server kept the
 * last 40 turns (`turns.slice(-40)` in api/vinaxai.ts). Past that, the opening
 * of a long conversation simply vanished — the model would answer "what did I
 * ask you first?" from whatever was left, with no sign that anything had been
 * dropped.
 *
 * What happens now: the recent turns are sent in full, and the turns that fall
 * outside the window are replaced by a DIGEST — the earlier questions, in order,
 * clipped. Two deliberate decisions:
 *
 *   - The digest is built ON DEVICE and lists only what the LISTENER asked. It
 *     makes no claim about what the assistant answered, because summarising the
 *     answers without a model would mean inventing them.
 *   - It is labelled as a list of earlier questions, not as a summary, and it
 *     says plainly that the full text of those turns is no longer in context.
 *     The model is told not to treat it as the listener's current request.
 *
 * So nothing is fabricated, nothing is silently lost, and a listener can still
 * ask "go back to my second question" after fifty turns.
 */

/** Turns sent verbatim. The server keeps the last 40; staying under it keeps the digest from being cut. */
export const KEEP_TURNS = 30;
/** Earlier questions listed in the digest (oldest first, trimmed to the most recent of them). */
export const DIGEST_QUESTIONS = 20;
/** Characters per listed question. */
const QUESTION_CLIP = 140;
/** A thread shorter than this is sent as it is. */
export const DIGEST_FROM_TURNS = KEEP_TURNS + 4;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A user turn as one short line. Attachment blocks (`--- File: … ---`, added by
 * features/ai/attachments.ts) are named rather than quoted: a digest full of
 * pasted file text would be the very thing it exists to avoid.
 */
export function questionLine(content: string): string {
  const cut = content.indexOf('\n\n--- File:');
  const asked = oneLine(cut >= 0 ? content.slice(0, cut) : content);
  const files = [...content.matchAll(/--- File: ([^\n]*?)(?: \(excerpt\))? ---/g)].map((m) => m[1]).filter(Boolean);
  const base = asked || '(an attachment with no question)';
  const clipped = base.length > QUESTION_CLIP ? `${base.slice(0, QUESTION_CLIP - 1)}…` : base;
  return files.length ? `${clipped} [with ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 3).join(', ')}]` : clipped;
}

export interface TrimmedThread {
  /** The turns to send verbatim. */
  turns: Msg[];
  /**
   * A context message to put before them, or '' when the thread is short enough
   * that nothing was dropped.
   */
  digest: string;
  /** How many turns were replaced by the digest. */
  dropped: number;
}

/**
 * Trim a conversation to the recent window, with a digest of what was dropped.
 * Pure; the caller decides where the digest goes in the request.
 */
export function trimThread(conversation: readonly Msg[], keep = KEEP_TURNS): TrimmedThread {
  const usable = conversation.filter((m) => !m.failed);
  if (usable.length <= Math.max(keep, DIGEST_FROM_TURNS)) return { turns: [...usable], digest: '', dropped: 0 };
  const cutAt = usable.length - keep;
  const earlier = usable.slice(0, cutAt);
  const questions = earlier.filter((m) => m.role === 'user' && m.content.trim()).map((m) => questionLine(m.content));
  const listed = questions.slice(-DIGEST_QUESTIONS);
  if (!listed.length) return { turns: usable.slice(cutAt), digest: '', dropped: earlier.length };
  const omitted = questions.length - listed.length;
  const lines = [
    `EARLIER IN THIS CONVERSATION — ${earlier.length} turns are no longer in context. These are the questions the user asked in them, oldest first${omitted > 0 ? ` (${omitted} older one${omitted === 1 ? '' : 's'} not listed)` : ''}. The answers you gave are NOT included, so do not restate them as if you remember them; if the user refers back to one, say you no longer have its text and ask them to paste the part that matters. This is history, not the current request.`,
    ...listed.map((q, i) => `${i + 1}. ${q}`),
  ];
  return { turns: usable.slice(cutAt), digest: lines.join('\n'), dropped: earlier.length };
}
