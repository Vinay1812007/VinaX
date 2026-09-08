/**
 * v5.17.0 — view-only sort for a collection page. The stored order is never
 * touched; the page just presents a sorted copy. Also the Fisher–Yates shuffle
 * behind "Shuffle play".
 */
import type { Song } from '@/types';
import { primaryArtist } from './duplicates';

export type CollectionSort = 'added' | 'title' | 'artist' | 'duration' | 'newest';

export const SORT_OPTIONS: ReadonlyArray<{ value: CollectionSort; label: string }> = [
  { value: 'added', label: 'Added order' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'duration', label: 'Duration' },
  { value: 'newest', label: 'Newest year' },
];

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function yearOf(song: Song): number {
  const n = Number.parseInt(song.year ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** Returns a new array; 'added' keeps the stored order. Sorts are stable. */
export function sortSongs(songs: Song[], sort: CollectionSort): Song[] {
  const list = [...songs];
  switch (sort) {
    case 'title':
      return list.sort((a, b) => collator.compare(a.title, b.title));
    case 'artist':
      return list.sort((a, b) => collator.compare(primaryArtist(a), primaryArtist(b)) || collator.compare(a.title, b.title));
    case 'duration':
      return list.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    case 'newest':
      return list.sort((a, b) => yearOf(b) - yearOf(a));
    default:
      return list;
  }
}

/** Unbiased shuffle of a copy; the input is left alone. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
