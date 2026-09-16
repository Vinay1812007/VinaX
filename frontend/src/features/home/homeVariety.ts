import type { Song } from '@/types';

/**
 * v6.5.0 — visit-to-visit variety for the AI Home shelves. The catalogue
 * ranks by popularity, so the same query lands the same top hits every time;
 * rotating the result PAGE per visit and preferring songs this listener has
 * not been shown recently keeps a rebuilt Home visibly different while the
 * shelves stay on-taste.
 */

/** Cheap 32-bit FNV-1a hash of a string. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 1-based catalogue page for this shelf on this visit (1..maxPage). */
export function rotatePage(query: string, visitNonce: number, shelfIndex: number, maxPage = 3): number {
  const pages = Math.max(1, Math.floor(maxPage));
  return (hashStr(`${query}|${visitNonce}|${shelfIndex}`) % pages) + 1;
}

/** Unseen songs first, then the rest, each group in its incoming order. */
export function biasUnseenFirst(songs: Song[], seenIds: ReadonlySet<string>): Song[] {
  if (!seenIds.size) return songs;
  const unseen: Song[] = [];
  const seen: Song[] = [];
  for (const s of songs) (seenIds.has(s.id) ? seen : unseen).push(s);
  return [...unseen, ...seen];
}
