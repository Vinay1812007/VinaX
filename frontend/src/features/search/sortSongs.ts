/**
 * v5.17.0 — Songs-tab sort orders. 'relevance' keeps the incoming order (the
 * ranking pass); every other order is a stable sort with unknown values last.
 */
import type { Song } from '@/types';
import type { SongSort } from '@/store/searchStore';

export const SONG_SORT_LABELS: Record<SongSort, string> = {
  relevance: 'Relevance',
  popular: 'Popular',
  newest: 'Newest',
  longest: 'Longest',
  shortest: 'Shortest',
  az: 'A→Z',
};

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Descending on a numeric key; songs missing the key sink to the bottom. */
function byNumberDesc(pick: (s: Song) => number | null): (a: Song, b: Song) => number {
  return (a, b) => {
    const x = pick(a);
    const y = pick(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  };
}

export function sortSongs(songs: Song[], sort: SongSort): Song[] {
  switch (sort) {
    case 'relevance':
      return songs;
    case 'popular':
      return [...songs].sort(byNumberDesc((s) => num(s.playCount)));
    case 'newest':
      return [...songs].sort(byNumberDesc((s) => num(s.year)));
    case 'longest':
      return [...songs].sort(byNumberDesc((s) => num(s.duration)));
    case 'shortest': {
      const desc = byNumberDesc((s) => num(s.duration));
      // Ascending, but unknown durations still sink to the bottom.
      return [...songs].sort((a, b) => {
        const x = num(a.duration);
        const y = num(b.duration);
        if (x == null || y == null) return desc(a, b);
        return x - y;
      });
    }
    case 'az':
      return [...songs].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
      );
    default:
      return songs;
  }
}

/** Local "filter these results": title, subtitle or any credited artist. */
export function filterSongsLocally(songs: Song[], text: string): Song[] {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const words = fold(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return songs;
  return songs.filter((s) => {
    const haystack = fold(
      [s.title, s.subtitle, s.album?.name ?? '', ...s.artists.map((a) => a.name)].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}
