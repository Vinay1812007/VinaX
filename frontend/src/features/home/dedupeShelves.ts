import type { Song } from '@/types';

/** Each render owns its ledger. Never persist during React render: doing so
 * makes the next render hide the very shelves the previous render displayed.
 * Cross-visit freshness is handled by homeVariety after queries resolve. */
export function createShelfDeduper(): (songs: Song[]) => Song[] {
  const seen = new Set<string>();
  return (songs) => songs.filter((song) => {
    if (!song || seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

/** Remove the legacy render-time ledger on explicit refresh. */
export function resetShelfDeduper(): void {
  try { window.sessionStorage.removeItem('vinax.home.deduped.v1'); } catch { /* optional storage */ }
}

/** Pure helper: de-dupe an ordered list of shelves against each other.
 *  Does NOT persist — this is the deterministic version used by tests. */
export function dedupeShelves(shelves: Song[][]): Song[][] {
  const seen = new Set<string>();
  return shelves.map((songs) => {
    const out: Song[] = [];
    for (const song of songs) {
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push(song);
    }
    return out;
  });
}
