/**
 * v5.19.0 — literal-match boosts layered on top of the taste ranking pass.
 * Pure and cheap: one folded title (and one credits line) per song, plain
 * `includes`/`startsWith` on them. Order within a tier is the incoming order
 * (stable), so the taste/relevance pass still decides everything the query
 * text doesn't — except among exact-title hits, where the original cut and
 * the more-played one lead.
 */
import type { Song } from '@/types';
import { versionKind, type VersionKind } from '@/services/recommendation/songIdentity';

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Comparison only: joiners change rendering, not which word was typed.
    .replace(/[\u200c\u200d]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Punctuation-free form for comparing: apostrophes vanish ("don't" reads as
 *  "dont"), everything else that is not a letter, digit or mark becomes a
 *  space ("artist - title" reads as "artist title"). Marks stay — Indic vowel
 *  signs are marks. Falls back to the input when nothing else is left. */
function plain(folded: string): string {
  const out = folded
    .replace(/['\u2018\u2019\u02bc]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || folded;
}

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
 *  query word, 0 = no literal match. Punctuation never decides a tier.
 *  Exported for tests. */
export function matchTier(title: string, query: string, words: readonly string[]): number {
  if (!query) return 0;
  const folded = fold(title);
  const lower = plain(folded);
  const core = plain(coreTitle(folded));
  query = plain(fold(query));
  words = words.flatMap((w) => plain(fold(w)).split(' ')).filter(Boolean);
  if (lower === query || core === query) return 3;
  if (lower.startsWith(query)) return 2;
  if (words.length && words.every((w) => lower.includes(w))) return 1;
  return 0;
}

const CREDIT_FULL = 25;
const CREDIT_PARTIAL = 5;

/**
 * "title artist" / "artist - title" queries: the title alone matches nothing,
 * but title + credits do. CREDIT_FULL when every core-title word was typed and
 * the rest of the query is all in the credits (singer, film, album);
 * CREDIT_PARTIAL when every query word lands somewhere in title ∪ credits with
 * at least one in the title. Exported for tests.
 */
export function creditScore(song: Song, words: readonly string[]): number {
  if (words.length < 2) return 0;
  const folded = fold(song.title);
  const title = plain(folded);
  const titleWords = plain(coreTitle(folded)).split(' ').filter(Boolean);
  const credits = plain(
    fold([song.subtitle ?? '', ...song.artists.map((a) => a.name), song.album?.name ?? ''].join(' ')),
  );
  const typed = new Set(words);
  const rest = words.filter((w) => !titleWords.includes(w));
  if (
    titleWords.length > 0 &&
    rest.length > 0 &&
    titleWords.every((w) => typed.has(w)) &&
    rest.every((w) => credits.includes(w))
  )
    return CREDIT_FULL;
  const inTitle = words.filter((w) => title.includes(w));
  if (inTitle.length > 0 && words.every((w) => title.includes(w) || credits.includes(w)))
    return CREDIT_PARTIAL;
  return 0;
}

const VERSION_ORDER: Record<VersionKind, number> = { original: 0, remaster: 1, alternate: 2 };

/**
 * Exact title first, then a title + credits match, then title-starts-with,
 * then titles holding all the query words; a small nudge for songs in the
 * listener's pinned languages (never enough to jump a tier); everything else
 * keeps its incoming order. Among exact hits the original leads a remaster
 * leads an alternate cut (karaoke, remix, slowed…), then the more-played one.
 */
export function rerankSongs(
  songs: Song[],
  query: string,
  pinnedLanguages: readonly string[],
): Song[] {
  if (songs.length < 2) return songs;
  const q = plain(fold(query));
  const words = q ? q.split(' ').filter((w) => w.length >= 2) : [];
  const pinned = new Set(pinnedLanguages);
  const boostable = q.length > 0 || pinned.size > 0;
  if (!boostable) return songs;
  const scored = songs.map((song, i) => {
    const tier = matchTier(song.title, q, words);
    // Credits only speak when the title alone matched nothing.
    const base = tier > 0 ? tier * 10 : creditScore(song, words);
    const exact = tier === 3 || base === CREDIT_FULL;
    return {
      song,
      base,
      exact,
      version: exact ? VERSION_ORDER[versionKind(song.title)] : 0,
      pin: song.language && pinned.has(song.language) ? 1 : 0,
      i,
    };
  });
  scored.sort((a, b) => b.base - a.base || a.version - b.version || b.pin - a.pin || a.i - b.i);
  // Popularity settles what is left of an exact-hit tie. Only songs with a
  // known count trade places (among the slots they already hold), so a missing
  // count never reads as "unpopular" and the order stays well-defined.
  for (let start = 0; start < scored.length; ) {
    const head = scored[start];
    let end = start + 1;
    while (
      end < scored.length &&
      scored[end].base === head.base &&
      scored[end].version === head.version &&
      scored[end].pin === head.pin
    )
      end += 1;
    if (head.exact && end - start > 1) {
      const slots: number[] = [];
      for (let k = start; k < end; k += 1) if (scored[k].song.playCount !== null) slots.push(k);
      const counted = slots
        .map((k) => scored[k])
        .sort((a, b) => (b.song.playCount ?? 0) - (a.song.playCount ?? 0) || a.i - b.i);
      slots.forEach((k, n) => {
        scored[k] = counted[n];
      });
    }
    start = end;
  }
  return scored.map((x) => x.song);
}

/**
 * Title completions for the suggestion list — from SETTLED results for the
 * text in the box only. While the next query is loading the hook still holds
 * the previous query's songs (placeholder data), and while the listener is
 * mid-word the results belong to the debounced query, not the typed one;
 * either way the titles would be another query's, so nothing is offered.
 */
export function suggestTitles(
  songs: readonly Song[],
  typed: string,
  state: { resultsQuery: string; typedQuery: string; placeholder: boolean },
  limit = 7,
): string[] {
  if (state.placeholder || state.resultsQuery !== state.typedQuery) return [];
  const typedKey = typed.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of songs) {
    const t = s.title.trim();
    const key = t.toLowerCase();
    if (t && key !== typedKey && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
    if (out.length >= limit) break;
  }
  return out;
}
