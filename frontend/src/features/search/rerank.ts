/**
 * v5.19.0 — literal-match boosts layered on top of the taste ranking pass.
 * Pure and cheap: one lower-cased title per song, `includes`/`startsWith`
 * only, no regex. Order within a tier is the incoming order (stable), so the
 * taste/relevance pass still decides everything the query text doesn't.
 */
import type { Song } from '@/types';

/** Title text before any "(From …)" / "[…]" suffix, lower-cased. */
function coreTitle(lower: string): string {
  const paren = lower.indexOf(' (');
  const bracket = lower.indexOf(' [');
  let cut = lower.length;
  if (paren > 0) cut = Math.min(cut, paren);
  if (bracket > 0) cut = Math.min(cut, bracket);
  return cut < lower.length ? lower.slice(0, cut).trim() : lower;
}

/** 3 = exact title, 2 = title starts with the query, 1 = title holds every
 *  query word, 0 = no literal match. Exported for tests. */
export function matchTier(title: string, query: string, words: readonly string[]): number {
  if (!query) return 0;
  const lower = title.toLowerCase();
  const core = coreTitle(lower);
  if (lower === query || core === query) return 3;
  if (lower.startsWith(query)) return 2;
  if (words.length && words.every((w) => lower.includes(w))) return 1;
  return 0;
}

/**
 * Exact title first, then title-starts-with, then titles holding all the
 * query words; a small nudge for songs in the listener's pinned languages
 * (never enough to jump a tier); everything else keeps its incoming order.
 */
export function rerankSongs(songs: Song[], query: string, pinnedLanguages: readonly string[]): Song[] {
  if (songs.length < 2) return songs;
  const q = query.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
  const words = q ? q.split(' ').filter((w) => w.length >= 2) : [];
  const pinned = new Set(pinnedLanguages);
  const boostable = q.length > 0 || pinned.size > 0;
  if (!boostable) return songs;
  const scored = songs.map((song, i) => {
    let score = matchTier(song.title, q, words) * 10;
    if (song.language && pinned.has(song.language)) score += 1;
    return { song, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((x) => x.song);
}
