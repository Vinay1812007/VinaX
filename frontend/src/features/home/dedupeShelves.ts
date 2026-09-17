import type { Song } from '@/types';
import { songKey } from '@/services/recommendation/songIdentity';

/** v7.0.0 — a song is "already shown" by catalogue id OR by canonical identity, so the
 *  film cut, the remaster and the lofi flip of one song never fill three shelves. */
function firstSighting(seen: Set<string>, song: Song): boolean {
  const key = `k:${songKey(song)}`;
  if (seen.has(song.id) || seen.has(key)) return false;
  seen.add(song.id);
  seen.add(key);
  return true;
}

/** Each render owns its ledger. Never persist during React render: doing so
 * makes the next render hide the very shelves the previous render displayed.
 * Shared song identity tracks recently displayed catalog music. */
export function createShelfDeduper(): (songs: Song[]) => Song[] {
  const seen = new Set<string>();
  return (songs) => songs.filter((song) => !!song && firstSighting(seen, song));
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
      if (!song || !firstSighting(seen, song)) continue;
      out.push(song);
    }
    return out;
  });
}
