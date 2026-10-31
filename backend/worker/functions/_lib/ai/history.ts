/**
 * VinaX AI — the message tree and what a model is sent from it.
 *
 * Messages form a tree through `parent_id`: an edit or a retry adds a
 * sibling, so earlier answers are never lost. The thread a model sees is the
 * path from the root to one leaf, trimmed to the model's context budget:
 * the latest turn always stays, and the thread never starts on an assistant
 * turn whose question was trimmed away.
 */
import type { MessagePart, NormalizedMessage } from './types';

export interface TreeMessage {
  id: string;
  parent_id: string | null;
  role: 'user' | 'assistant';
  content: MessagePart[] | null;
  created_at: string;
}

/** The path root → `leafId` (empty when the id is not in the tree). */
export function pathTo<T extends TreeMessage>(rows: readonly T[], leafId: string | null): T[] {
  if (!leafId) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(leafId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out.reverse();
}

/** The newest message that has no children: where a reload opens when no leaf was saved. */
export function latestLeaf<T extends TreeMessage>(rows: readonly T[]): T | null {
  const parents = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  let best: T | null = null;
  for (const r of rows) if (!parents.has(r.id) && (!best || r.created_at >= best.created_at)) best = r;
  return best;
}

/** The text of a message's parts; files appear as "[file: name]" (materialize.ts sends the files themselves). */
export function textOf(content: MessagePart[] | null | undefined): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p?.type === 'text' ? String(p.text ?? '') : p?.type === 'attachment' ? `[file: ${p.name ?? 'attachment'}]` : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** Only the typed text of a message, without its files. */
export function typedText(content: MessagePart[] | null | undefined): string {
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p?.type === 'text').map((p) => String(p.text ?? '')).filter(Boolean).join('\n\n');
}

/**
 * The path as turns for a model. Empty turns are dropped and two turns in a
 * row from the same side (a question whose answer failed, then another
 * question) are joined, since some providers insist on alternating turns.
 */
export function toNormalized(path: readonly TreeMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const r of path) {
    const text = textOf(r.content);
    if (!text.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === r.role) prev.text = `${prev.text}\n\n${text}`;
    else out.push({ role: r.role, text });
  }
  return out;
}

/** Cut text longer than `max` from the middle, keeping its start and end. */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const note = '\n\n[… part of this message was left out to fit …]\n\n';
  const keep = Math.max(0, max - note.length);
  const head = Math.ceil(keep * 0.6);
  return text.slice(0, head) + note + text.slice(text.length - (keep - head));
}

/**
 * The newest turns that fit in `maxChars`. The latest turn always stays
 * (clipped if it alone is too long), and the result starts on a user turn.
 */
export function trimHistory(messages: readonly NormalizedMessage[], maxChars: number): NormalizedMessage[] {
  if (!messages.length) return [];
  const last = messages[messages.length - 1];
  const kept: NormalizedMessage[] = [{ ...last, text: clipMiddle(last.text, maxChars) }];
  let used = kept[0].text.length;
  for (let i = messages.length - 2; i >= 0; i--) {
    const len = messages[i].text.length;
    if (used + len > maxChars) break;
    kept.unshift(messages[i]);
    used += len;
  }
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return kept;
}

export const threadChars = (messages: readonly NormalizedMessage[]): number => messages.reduce((n, msg) => n + msg.text.length, 0);

/** A first title from the first message: up to six words, at most 60 characters. */
export function fallbackTitle(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  const t = words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words;
  return t || 'New chat';
}
