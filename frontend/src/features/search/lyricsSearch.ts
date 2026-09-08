/**
 * v5.17.0 — "Search by lyrics": pure helpers that turn lyrics-service hits
 * into catalogue songs and render the matched line. Kept free of React so the
 * matching rules are unit-testable.
 */
import type { Song } from '@/types';
import type { LyricsSearchHit } from '@/services/lyrics/lrclib';
import { searchSongs } from '@/services/api/saavn';

/** A lyric hit paired with the catalogue song it resolved to. */
export interface LyricsMatch {
  hit: LyricsSearchHit;
  song: Song;
  /** v5.19.0 — 'lyrics' = the lyrics service matched the words; 'catalogue'
   *  = the lyrics service had nothing and a title search stood in (many
   *  Telugu/Tamil songs are titled by their first line). */
  source: 'lyrics' | 'catalogue';
}

/** v5.19.0 — a catalogue search function, as the hooks bind it (with signal). */
export type CatalogueSearch = (query: string, limit: number) => Promise<Song[]>;

/** Words of a query worth matching: lowercase, punctuation-free, 2+ chars. */
export function queryWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 2);
}

/** A query of five or more words reads as a lyric line, not a title. */
export function looksLikeLyric(text: string): boolean {
  return queryWords(text).length >= 5;
}

const NOISE = new Set(['from', 'the', 'a', 'an', 'feat', 'ft', 'film', 'movie', 'version', 'song']);

function norm(s: string): string {
  return s
    .replace(/\s*\((?:from|from the|from movie|from\s+the\s+movie)\b[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((t) => t.length > 1 && !NOISE.has(t)));
}

/** How much a catalogue song's title looks like the lyrics hit's title. */
function titleScore(want: string, got: string): number {
  const w = norm(want);
  const g = norm(got);
  if (!w || !g) return -1000;
  if (w === g) return 60;
  if (w.includes(g) || g.includes(w)) return 40;
  const a = tokens(w);
  const b = tokens(g);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 && inter / union >= 0.5 ? 25 : -1000;
}

/**
 * Pick the catalogue song that best matches a lyrics hit: the title must
 * resemble the hit's title (a gate, never a bonus), then a shared artist word
 * and a close duration break ties. Returns null when nothing is close enough
 * so a wrong song never masquerades as the match.
 */
export function pickBest(hit: LyricsSearchHit, candidates: Song[]): Song | null {
  if (!candidates.length) return null;
  const artistTokens = [...tokens(hit.artist)];
  const score = (s: Song): number => {
    let n = titleScore(hit.title, s.title);
    if (n <= -1000) return n;
    const credits = norm([s.subtitle, ...s.artists.map((a) => a.name)].join(' '));
    if (artistTokens.length && artistTokens.some((t) => credits.includes(t))) n += 15;
    if (hit.duration && s.duration) {
      const dd = Math.abs(s.duration - hit.duration);
      n += dd <= 3 ? 30 : dd <= 10 ? 15 : dd <= 30 ? 0 : -20;
    }
    if (s.hasLyrics) n += 2;
    return n;
  };
  let best: Song | null = null;
  let bestScore = 0;
  for (const s of candidates) {
    const n = score(s);
    if (n > bestScore) {
      best = s;
      bestScore = n;
    }
  }
  return best;
}

/** Resolve every lyrics hit to a catalogue song (in parallel), dropping the
 *  ones with no convincing match and any song that already appeared. */
export async function resolveLyricsHits(
  hits: LyricsSearchHit[],
  search: CatalogueSearch = searchSongs,
): Promise<LyricsMatch[]> {
  const settled = await Promise.allSettled(
    hits.map(async (hit) => {
      const q = [hit.title, hit.artist].filter(Boolean).join(' ');
      const song = pickBest(hit, await search(q, 3));
      return song ? { hit, song, source: 'lyrics' as const } : null;
    }),
  );
  const out: LyricsMatch[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value || seen.has(r.value.song.id)) continue;
    seen.add(r.value.song.id);
    out.push(r.value);
  }
  return out;
}

/** v5.19.0 — the first four query words, or '' when that is the whole line. */
export function firstWords(line: string, count = 4): string {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length > count ? words.slice(0, count).join(' ') : '';
}

/** v5.19.0 — pure merge for the catalogue fallback: the full-line results
 *  first, then the first-four-words results, each song once. Rejected
 *  lookups contribute nothing. Exported for tests. */
export function mergeCatalogueFallback(
  results: readonly PromiseSettledResult<Song[]>[],
  limit = CATALOGUE_FALLBACK_LIMIT,
): LyricsMatch[] {
  const out: LyricsMatch[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const song of r.value) {
      if (!song?.id || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push({
        hit: { title: song.title, artist: song.subtitle ?? '', album: song.album?.name ?? '', duration: song.duration, snippet: '' },
        song,
        source: 'catalogue',
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export const CATALOGUE_FALLBACK_LIMIT = 8;

/**
 * v5.19.0 — when the lyrics service comes up empty (or errors/times out),
 * search the catalogue by the line itself and by its first four words, in
 * parallel; a song titled by its opening line is found either way.
 */
export async function catalogueFallback(line: string, search: CatalogueSearch = searchSongs): Promise<LyricsMatch[]> {
  const full = line.trim().replace(/\s+/g, ' ');
  if (!full) return [];
  const head = firstWords(full);
  const lookups = [search(full, CATALOGUE_FALLBACK_LIMIT)];
  if (head) lookups.push(search(head, CATALOGUE_FALLBACK_LIMIT));
  return mergeCatalogueFallback(await Promise.allSettled(lookups));
}

/** A snippet split into runs, `hit` runs being the query words to highlight. */
export interface SnippetRun {
  text: string;
  hit: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a snippet so every occurrence of a query word (case-insensitive,
 *  longest words first) can be wrapped in <mark>. */
export function splitHighlight(snippet: string, query: string): SnippetRun[] {
  const words = [...new Set(queryWords(query))].sort((a, b) => b.length - a.length);
  if (!snippet || !words.length) return snippet ? [{ text: snippet, hit: false }] : [];
  const re = new RegExp(words.map(escapeRe).join('|'), 'giu');
  const runs: SnippetRun[] = [];
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) runs.push({ text: snippet.slice(last, i), hit: false });
    runs.push({ text: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < snippet.length) runs.push({ text: snippet.slice(last), hit: false });
  return runs;
}
