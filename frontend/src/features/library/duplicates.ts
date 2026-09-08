/**
 * v5.17.0 — duplicate finder for local collections. Two songs count as the
 * same track when they share an id, OR when their normalised title and first
 * artist match (the catalog often lists the same recording under several ids —
 * a remaster, a compilation copy, a lyric-video upload). Pure; no store access.
 */
import type { Song } from '@/types';

/** Lower-case, accent-stripped, punctuation-free key for fuzzy matching. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First credited artist, falling back to the subtitle's first comma-part. */
export function primaryArtist(song: Song): string {
  const named = song.artists.find((a) => a.name && a.name.trim());
  if (named) return named.name.trim();
  return (song.subtitle ?? '').split(',')[0].trim();
}

/** Title + first artist key — the "same track under another id" match. */
export function songMatchKey(song: Song): string {
  return `${normalizeText(song.title)}|${normalizeText(primaryArtist(song))}`;
}

export interface DuplicateReport {
  /** Songs that repeat an earlier entry (every occurrence after the first). */
  duplicates: Song[];
  /** The list with only the first occurrence of each track kept, in order. */
  unique: Song[];
}

/** Keeps the FIRST occurrence of every track; later repeats are reported. */
export function findDuplicates(songs: Song[]): DuplicateReport {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const unique: Song[] = [];
  const duplicates: Song[] = [];
  for (const song of songs) {
    const key = songMatchKey(song);
    const repeat = ids.has(song.id) || (key !== '|' && keys.has(key));
    if (repeat) {
      duplicates.push(song);
      continue;
    }
    ids.add(song.id);
    keys.add(key);
    unique.push(song);
  }
  return { duplicates, unique };
}
