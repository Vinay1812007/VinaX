import type { Song } from '@/types';

export type ArtistSongSort = 'popular' | 'newest' | 'az';

/** The artist page's song orders: the catalogue's own (popular), newest first, A–Z. */
export const ARTIST_SONG_SORTS: ReadonlyArray<{ id: ArtistSongSort; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'az', label: 'A–Z' },
];

/** A new list in the chosen order; "popular" keeps the catalogue's order. Ties keep their place. */
export function sortArtistSongs(songs: readonly Song[], sort: ArtistSongSort): Song[] {
  if (sort === 'popular') return [...songs];
  const indexed = songs.map((song, i) => ({ song, i }));
  if (sort === 'newest') {
    const year = (s: Song) => Number(s.year) || 0;
    indexed.sort((a, b) => year(b.song) - year(a.song) || a.i - b.i);
  } else {
    indexed.sort((a, b) => a.song.title.localeCompare(b.song.title, undefined, { sensitivity: 'base' }) || a.i - b.i);
  }
  return indexed.map((x) => x.song);
}

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 9512264 → "9.5M": listener and follower counts on the artist page. */
export function compactCount(n: number): string {
  return compactFmt.format(n);
}
