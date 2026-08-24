import type { ScoredCandidate } from './types';

/** Small, fast, deterministic PRNG (same family as scoring.ts). Seeded so a
 *  given salt reproduces its shuffle, but every fresh salt reorders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rotate the LEADING picks of a ranked continuation so two consecutive
 * next-song chains built from the same seed do not come out identical, without
 * sacrificing relevance: only the top `window` (all strong, high-fit picks) are
 * seed-shuffled; everything past the window keeps its rank order. Paired with a
 * random per-call salt this makes "radio" / auto-continue feel alive instead of
 * replaying the same handful every time (v3.6.0).
 */
export function rotateTop<T extends ScoredCandidate>(list: T[], salt: number, window = 10): T[] {
  if (list.length <= 2) return list.slice();
  const n = Math.min(window, list.length);
  const head = list.slice(0, n);
  const rng = mulberry32((salt | 0) || 1);
  for (let k = head.length - 1; k > 0; k -= 1) {
    const r = Math.floor(rng() * (k + 1));
    [head[k], head[r]] = [head[r], head[k]];
  }
  return [...head, ...list.slice(n)];
}

/** Drop candidates the listener played recently (or that are already queued) so
 *  the auto-queue stops looping the same songs. Pure + order-preserving. */
export function excludeRecent<T extends ScoredCandidate>(list: T[], recentIds: Set<string>): T[] {
  if (!recentIds.size) return list;
  return list.filter((c) => !recentIds.has(c.candidate.song.id));
}
