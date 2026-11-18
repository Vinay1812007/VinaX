/**
 * VinaX AI — "Ask about this": select some of a reply's text and a small
 * button appears over it; pressing it quotes the selection above the
 * composer, for a question about that part. The selection must lie inside
 * one finished reply's prose (never the composer, code being edited, or
 * the listener's own messages).
 */
import { useEffect, useState, type RefObject } from 'react';

export interface SelectionAsk {
  text: string;
  /** Where the button goes, relative to the chat root. */
  left: number;
  top: number;
}

export const SELECTION_MIN = 3;
export const SELECTION_MAX = 1_500;

/** The selection's text when it lies inside a reply's prose in `root`, else null. */
export function replySelection(root: HTMLElement | null, sel: Selection | null): { text: string; range: Range } | null {
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const within = (node: Node | null): Element | null => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    return el?.closest('.vx-ai-turn-reply:not([aria-busy="true"]) .vx-ai-md') ?? null;
  };
  const start = within(range.startContainer);
  const end = within(range.endContainer);
  if (!start || start !== end || !root.contains(start)) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < SELECTION_MIN) return null;
  return { text: text.length > SELECTION_MAX ? `${text.slice(0, SELECTION_MAX - 1).trimEnd()}…` : text, range };
}

export function useSelectionAsk(root: RefObject<HTMLElement | null>, enabled: boolean): SelectionAsk | null {
  const [ask, setAsk] = useState<SelectionAsk | null>(null);
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') { setAsk(null); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const found = replySelection(root.current, document.getSelection());
      if (!found || !root.current) { setAsk(null); return; }
      const rect = found.range.getBoundingClientRect();
      const host = root.current.getBoundingClientRect();
      if (!rect.width && !rect.height) { setAsk(null); return; }
      setAsk({ text: found.text, left: rect.left + rect.width / 2 - host.left, top: rect.top - host.top });
    };
    // Mouse and touch selections settle after the pointer lifts; keyboard ones on the next change.
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(read, 160); };
    document.addEventListener('selectionchange', later);
    document.addEventListener('pointerup', later);
    document.addEventListener('keyup', later);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('selectionchange', later);
      document.removeEventListener('pointerup', later);
      document.removeEventListener('keyup', later);
    };
  }, [root, enabled]);
  return ask;
}

/** The quoted part of a message: the selection as a Markdown quote above the question. */
export function withQuote(quote: string | null, text: string): string {
  const q = quote?.trim();
  if (!q) return text;
  const block = q.split('\n').map((l) => `> ${l}`).join('\n');
  return text.trim() ? `${block}\n\n${text}` : block;
}
