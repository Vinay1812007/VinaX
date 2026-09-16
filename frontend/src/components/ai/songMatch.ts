import type { Song } from '@/types';

/**
 * Catalogue matching for "Title — Artist" picks (AI replies, text imports).
 *
 * The old matcher lower-cased, then deleted every character outside a-z0-9.
 * A Telugu or Hindi title therefore normalised to "" — which `includes()`
 * every result — and, failing even that, the FIRST search result was
 * accepted unconditionally. Unrelated songs became "matches" silently.
 *
 * This version keeps Unicode letters, numbers and combining marks (Indic
 * vowel signs live in \p{M}), only strips Latin diacritics, scores title and
 * artist separately, and reports HOW sure it is: a pick resolves to
 * `matched`, `uncertain` (a plausible but unconfirmed candidate) or
 * `missing`. Callers decide what an uncertain match may do.
 */
export interface SongPickRef {
  title: string;
  artist: string;
}

export type MatchStatus = 'matched' | 'uncertain' | 'missing';

export interface ScoredCandidate {
  song: Song;
  /** 0..1 — how well the title matched. */
  title: number;
  /** 0..1 — how well the credited artists matched (0.5 when no artist was given). */
  artist: number;
  /** Weighted total, 0..1. */
  score: number;
}

export interface MatchResult {
  status: MatchStatus;
  /** The accepted (matched) or proposed (uncertain) song; null when missing. */
  song: Song | null;
  confidence: number;
  /** Ranked plausible candidates (best first, includes `song`), for review UIs. */
  alternatives: Song[];
}

export const MATCHED_AT = 0.8;
export const UNCERTAIN_AT = 0.5;

/** Lower-case, Latin-diacritic-free, punctuation-free; Unicode scripts survive. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    // Only the Latin combining block: Indic vowel signs are elsewhere and must stay.
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*\((?:from|from the)\b[^)]*\)/gi, ' ')
    .replace(/\s*\[(?:from|from the)\b[^\]]*\]/gi, ' ')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string): string[] => s.split(' ').filter(Boolean);

/** Sørensen–Dice over word sets — order-insensitive, tolerant of one extra word. */
function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  let hit = 0;
  for (const t of new Set(a)) if (B.has(t)) hit += 1;
  return (2 * hit) / (new Set(a).size + B.size);
}

function titleScore(want: string, got: string): number {
  if (!want || !got) return 0;
  if (want === got) return 1;
  const a = tokens(want);
  const b = tokens(got);
  let score = dice(a, b);
  // Substring containment ("Kesariya" vs "Kesariya (Dance Mix)") — only
  // when the shorter side is a real word and not a sliver of the longer one.
  const [shortS, longS] = want.length <= got.length ? [want, got] : [got, want];
  if (shortS.length >= 3 && longS.includes(shortS) && shortS.length / longS.length >= 0.45) score = Math.max(score, 0.75);
  return score;
}

function creditText(song: Song): string {
  return normalizeTitle(`${song.subtitle} ${song.artists.map((a) => a.name).join(' ')} ${song.album?.name ?? ''}`);
}

function artistScore(pickArtist: string, song: Song): number {
  const want = normalizeTitle(pickArtist);
  if (!want) return 0.5; // no artist given: neither confirms nor denies
  const credits = creditText(song);
  if (!credits) return 0;
  if (credits.includes(want)) return 1;
  const wantTokens = tokens(want).filter((t) => t.length >= 2);
  if (!wantTokens.length) return 0.5;
  const creditTokens = new Set(tokens(credits));
  const hits = wantTokens.filter((t) => creditTokens.has(t)).length;
  return hits / wantTokens.length;
}

export function scoreCandidates(pick: SongPickRef, results: Song[]): ScoredCandidate[] {
  const want = normalizeTitle(pick.title);
  if (!want) return [];
  const out: ScoredCandidate[] = [];
  for (const song of results) {
    const t = titleScore(want, normalizeTitle(song.title));
    if (t < 0.3) continue;
    const a = artistScore(pick.artist, song);
    out.push({ song, title: t, artist: a, score: Math.round((0.7 * t + 0.3 * a) * 1000) / 1000 });
  }
  return out.sort((x, y) => y.score - x.score || y.title - x.title);
}

/** Decide what a pick means given catalogue results. Never falls back to results[0]. */
export function matchPick(pick: SongPickRef, results: Song[]): MatchResult {
  const ranked = scoreCandidates(pick, results);
  const alternatives = ranked.slice(0, 5).map((c) => c.song);
  const best = ranked[0];
  if (!best) return { status: 'missing', song: null, confidence: 0, alternatives: [] };
  // A title that matched exactly with an explicitly contradicting artist is
  // a different song by the same name — never "matched", at most uncertain.
  const status: MatchStatus = best.score >= MATCHED_AT && best.title >= 0.6 ? 'matched' : best.score >= UNCERTAIN_AT ? 'uncertain' : 'missing';
  return { status, song: status === 'missing' ? null : best.song, confidence: best.score, alternatives: status === 'missing' ? alternatives : alternatives };
}

/** The stronger of two match attempts (used when a fallback search runs). */
export function betterMatch(a: MatchResult, b: MatchResult): MatchResult {
  const rank = (m: MatchResult) => (m.status === 'matched' ? 2 : m.status === 'uncertain' ? 1 : 0);
  if (rank(b) > rank(a) || (rank(b) === rank(a) && b.confidence > a.confidence)) {
    const seen = new Set(b.alternatives.map((s) => s.id));
    return { ...b, alternatives: [...b.alternatives, ...a.alternatives.filter((s) => !seen.has(s.id))].slice(0, 6) };
  }
  const seen = new Set(a.alternatives.map((s) => s.id));
  return { ...a, alternatives: [...a.alternatives, ...b.alternatives.filter((s) => !seen.has(s.id))].slice(0, 6) };
}
