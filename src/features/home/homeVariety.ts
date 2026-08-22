/**
 * Per-visit variety for the AI-personalized Home (v3.6.0).
 *
 * Two things kept Home serving the same rows every open:
 *  1. the upstream page was chosen by `date % 3` — deterministic, and identical
 *     for three days at a stretch;
 *  2. nothing remembered which songs Home had just shown, so the same top hits
 *     for a query resurfaced every single build.
 *
 * These pure helpers fix both: a visit-nonce-seeded page pick (different every
 * open), and a small localStorage set of recently-surfaced song ids that biases
 * each shelf toward songs it hasn't shown lately — softly, so a shelf is never
 * starved below its minimum.
 */

import { moodFromText, moodMatchScore } from '@/services/recommendation/mood';

/** Cheap 32-bit string hash (FNV-1a-ish) — stable across loads. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Which upstream page to pull for a shelf this visit. Seeded by the per-mount
 * visit nonce + the query + the shelf index, so every Home open rotates its
 * pages (was `date % 3` — repeated for days). Range 1..pages.
 */
export function rotatePage(query: string, nonce: number, idx: number, pages = 3): number {
  const seed = (hashStr(query) ^ (nonce >>> 0) ^ Math.imul(idx + 1, 2654435761)) >>> 0;
  return 1 + (seed % Math.max(1, pages));
}

/**
 * Bias a ranked shelf away from recently-surfaced songs WITHOUT starving it:
 * unseen songs keep their rank order and come first, already-seen songs follow
 * (also in rank order) so the shelf always fills. Order-preserving within each
 * group — relevance is never shuffled away, only de-duplicated across visits.
 */
export function biasUnseenFirst<T extends { id: string }>(songs: T[], seenIds: Set<string>): T[] {
  if (!seenIds.size) return songs;
  const unseen: T[] = [];
  const seen: T[] = [];
  for (const s of songs) (seenIds.has(s.id) ? seen : unseen).push(s);
  return [...unseen, ...seen];
}

/**
 * Package A9 — nudge a shelf's songs toward the mood its TITLE implies. A shelf
 * the AI titled "Chill late-night melodies" should not open with a party
 * banger. We infer the shelf's mood from its title, then stably sink the
 * clearly-clashing songs to the back — order preserved within each group, so
 * relevance is never shuffled away, only obvious mood outliers move. No-op for a
 * neutral/ambiguous title, a short shelf, or when nothing (or everything)
 * clashes. Pure and title-driven, so it degrades gracefully with `inferMood`.
 */
export function reorderByShelfMood<T extends { title: string; subtitle: string }>(title: string, songs: T[]): T[] {
  const shelfMood = moodFromText(title);
  if (shelfMood === 'neutral' || songs.length < 3) return songs;
  const fit: T[] = [];
  const clash: T[] = [];
  for (const s of songs) {
    (moodMatchScore(moodFromText(`${s.title} ${s.subtitle}`), shelfMood) > 0.1 ? fit : clash).push(s);
  }
  return fit.length && clash.length ? [...fit, ...clash] : songs;
}

const RECENT_KEY = 'vinax.aihome.recent.v1';
const RECENT_CAP = 80;

/** Song ids Home surfaced across recent visits (newest first, capped ~80). */
export function loadRecentHomeIds(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && !!x).slice(0, RECENT_CAP)
      : [];
  } catch {
    return [];
  }
}

/** Merge freshly surfaced ids in (newest first), dedupe, cap at 80. */
export function recordRecentHomeIds(ids: string[]): void {
  try {
    const merged = [...ids, ...loadRecentHomeIds()];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of merged) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(out.slice(0, RECENT_CAP)));
  } catch {
    /* ignore */
  }
}
