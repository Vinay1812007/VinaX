import type { Song } from '@/types';
import { normalizeText, primaryArtist } from './duplicates';

/**
 * v6.1.0 — in-collection text search. Matches words across title, credited
 * artists, subtitle and album, accent-insensitively and script-safe (Indic
 * vowel signs survive normalisation). Every query word must appear
 * somewhere. Pure; the page keeps the stored order and only filters a view.
 */
export function songMatchesQuery(song: Song, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = normalizeText(
    `${song.title} ${song.subtitle} ${song.artists.map((a) => a.name).join(' ')} ${song.album?.name ?? ''} ${song.year ?? ''}`,
  );
  return q.split(' ').every((w) => hay.includes(w));
}

export function filterSongs(songs: Song[], query: string): Song[] {
  if (!normalizeText(query)) return songs;
  return songs.filter((s) => songMatchesQuery(s, query));
}

/** "3 songs", "1 song". */
export const songCount = (n: number): string => `${n} song${n === 1 ? '' : 's'}`;

/** Artist label helper shared with the smart-collection preview. */
export const artistOf = primaryArtist;
