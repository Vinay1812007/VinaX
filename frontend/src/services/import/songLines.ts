/**
 * "Title — Artist" lines → catalogue songs, for the playlist import sheet.
 * Every line resolves to the real catalogue song with an honest verdict
 * (matched, uncertain or missing, see songMatch.ts); identical lines share
 * one lookup through react-query.
 */
import type { QueryClient } from '@tanstack/react-query';
import { searchSongs } from '@/services/api';
import { betterMatch, matchPick, type MatchResult, type SongPickRef } from './songMatch';

export type { MatchResult, SongPickRef } from './songMatch';

// One song line: optional list marker, then Title <dash> Artist, both short.
const LINE_RE = /^\s*(?:[-*•]\s*|\d+[.)]\s*)?(.{2,60}?)\s+[—–]\s+(.{2,60}?)\s*$/;

function cleanPart(s: string): string {
  return s
    .replace(/[*_`]+/g, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
}

/** "Title — Artist" → pick, or null for ordinary prose. */
export function parseSongLine(line: string): SongPickRef | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const title = cleanPart(m[1]);
  const artist = cleanPart(m[2]);
  if (!title || !artist) return null;
  // Prose that happens to carry a dash ("Yes — but only if…") has clause-like
  // halves; a song line has a short name on the left and no sentence
  // punctuation on the right.
  if (/[?!]/.test(title) || /[?!]/.test(artist)) return null;
  if (title.split(' ').length > 9 || artist.split(' ').length > 8) return null;
  return { title, artist };
}

const pickKey = (p: SongPickRef) => ['song-pick', p.title.toLowerCase(), p.artist.toLowerCase()] as const;
/** The react-query key for a pick (so callers can invalidate it for a fresh retry). */
export const pickQueryKey = pickKey;

/**
 * Resolve a pick against the catalogue with an honest verdict. The first
 * search combines title + artist; when that is not a confident match and
 * an artist was given, a title-only search runs and the stronger result
 * wins. Nothing here ever accepts "the first result" — see songMatch.ts.
 */
export async function resolvePickMatch(pick: SongPickRef, signal?: AbortSignal): Promise<MatchResult> {
  const combined = await searchSongs(`${pick.title} ${pick.artist}`.trim(), 6, { signal });
  let result = matchPick(pick, combined);
  if (result.status !== 'matched' && pick.artist) {
    if (signal?.aborted) return result;
    const byTitle = await searchSongs(pick.title, 6, { signal });
    result = betterMatch(result, matchPick(pick, byTitle));
  }
  return result;
}

const PICK_STALE_MS = 60 * 60_000;

/** Full verdict for a pick (cached an hour). Used by the import review. */
export function fetchPickMatch(qc: QueryClient, pick: SongPickRef, signal?: AbortSignal): Promise<MatchResult> {
  return qc.fetchQuery({ queryKey: pickKey(pick), queryFn: ({ signal: qs }) => resolvePickMatch(pick, signal ?? qs), staleTime: PICK_STALE_MS });
}
