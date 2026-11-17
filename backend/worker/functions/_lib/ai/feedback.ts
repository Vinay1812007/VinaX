/**
 * VinaX AI — thumbs up and down on replies (schema version 24: ai_feedback).
 *
 * One rating per reply per account, changeable: a thumbs down may carry a
 * short reason (Wrong, Not helpful, Too slow, Other) and a note of at most
 * 300 characters. The reply's model and provider are copied from the saved
 * message, never taken from the page, so the console's per-model score
 * (ai_feedback_stats) counts what really answered. A rating outlives its
 * chat (the link to the chat is cleared when the chat is purged) and goes
 * with the account.
 */
import { db, q, type DbEnv, type Rows } from '../db';

export type Rating = 'up' | 'down';
export const FEEDBACK_REASONS = ['wrong', 'not_helpful', 'too_slow', 'other'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export const FEEDBACK_NOTE_MAX = 300;

export interface FeedbackRow {
  message_id: string;
  conversation_id: string | null;
  account_id: string;
  model_id: string | null;
  provider: string | null;
  rating: Rating;
  reason: FeedbackReason | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
}

/** What the page sends and gets back. */
export interface PublicFeedback {
  rating: Rating;
  reason?: FeedbackReason;
  note?: string;
}

export type FeedbackInput =
  | { ok: true; clear: true }
  | { ok: true; clear: false; rating: Rating; reason: FeedbackReason | null; note: string | null };

/**
 * The rating a request asks for: `rating` "up" or "down", or null to take it
 * back. A reason and a note belong to a thumbs down only; a note is plain
 * text (control characters out), trimmed, at most 300 characters.
 */
export function parseFeedback(b: Record<string, unknown>): FeedbackInput | null {
  if (b.rating === null) return { ok: true, clear: true };
  if (b.rating !== 'up' && b.rating !== 'down') return null;
  if (b.reason != null && !(FEEDBACK_REASONS as readonly unknown[]).includes(b.reason)) return null;
  if (b.note != null && typeof b.note !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const note = typeof b.note === 'string' ? b.note.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (note.length > FEEDBACK_NOTE_MAX) return null;
  if (b.rating === 'up') return { ok: true, clear: false, rating: 'up', reason: null, note: null };
  return { ok: true, clear: false, rating: 'down', reason: (b.reason as FeedbackReason | undefined) ?? null, note: note || null };
}

export const publicFeedback = (r: Pick<FeedbackRow, 'rating' | 'reason' | 'note'>): PublicFeedback => ({
  rating: r.rating,
  ...(r.reason ? { reason: r.reason } : {}),
  ...(r.note ? { note: r.note } : {}),
});

export function saveFeedback(env: DbEnv, row: FeedbackRow): Promise<Rows<FeedbackRow>> {
  return db.upsert<FeedbackRow>(env, 'ai_feedback', { ...row, updated_at: new Date().toISOString() }, 'message_id,account_id');
}

export function clearFeedback(env: DbEnv, accountId: string, messageId: string): Promise<Rows<FeedbackRow>> {
  return db.remove<FeedbackRow>(env, 'ai_feedback', q().eq('account_id', accountId).eq('message_id', messageId));
}

/** The account's ratings in one chat, by message id. */
export async function feedbackIn(env: DbEnv, accountId: string, conversationId: string): Promise<Record<string, PublicFeedback> | null> {
  const r = await db.select<FeedbackRow>(env, 'ai_feedback', q().select('message_id,rating,reason,note').eq('account_id', accountId).eq('conversation_id', conversationId).limit(2_000));
  if (!r.ok) return null;
  return Object.fromEntries(r.rows.filter((row) => row.rating === 'up' || row.rating === 'down').map((row) => [row.message_id, publicFeedback(row)]));
}
