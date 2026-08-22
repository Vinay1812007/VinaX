import type { Song } from '@/types';

/**
 * Stateful home-page de-duplicator. Call it once per shelf in display order and
 * it returns only the songs not already shown in an earlier shelf, recording
 * each id it emits. Create a fresh deduper per render so it resets every time.
 */
export function createShelfDeduper(): (songs: Song[]) => Song[] {
  const seen = new Set<string>();
  return (songs) => {
    const out: Song[] = [];
    for (const song of songs) {
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push(song);
    }
    return out;
  };
}

/** Pure helper: de-dupe an ordered list of shelves against each other. */
export function dedupeShelves(shelves: Song[][]): Song[][] {
  const dedupe = createShelfDeduper();
  return shelves.map(dedupe);
}
