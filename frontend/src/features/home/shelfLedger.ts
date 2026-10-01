import { songKey } from '@/services/recommendation/songIdentity';
import type { Song } from '@/types';

/**
 * Cross-shelf de-duplication for a Home whose blocks are separate
 * components that mount (and re-render) independently.
 *
 * The previous ledger was a closure created per HomePage render and called
 * by thunks in display order — which only works when every shelf renders in
 * the same pass. With visibility-mounted blocks a shelf re-renders alone, so
 * a shared ledger keyed by (block, shelf position) is kept instead: a shelf
 * filters out song ids claimed by any shelf EARLIER in display order, then
 * records its own claim. Claims are replaced (never accumulated) so
 * re-renders are idempotent.
 */
const claims = new Map<string, { block: string; seq: number; ids: Set<string> }>();
let blockOrder: string[] = [];

export function setShelfBlockOrder(order: readonly string[]): void {
  blockOrder = [...order];
}

export function resetShelfLedger(): void {
  claims.clear();
}

/** Drop every claim a block made (called at the start of that block's render). */
export function beginBlock(block: string): void {
  for (const [key, c] of claims) if (c.block === block) claims.delete(key);
}

/**
 * 9.0.0 — the fewest songs a de-duplicated shelf keeps when it had at least
 * that many. A shelf that de-duplication would leave shorter takes back songs an
 * earlier shelf already showed (in its own order) until it has this many:
 * de-duplication should thin repeats out, not leave a Home of three-song
 * shelves. The songs taken back claim nothing, so they never thin a later shelf.
 */
export const SHELF_FLOOR = 6;

export function claimShelf(block: string, seq: number, songs: Song[], floor = SHELF_FLOOR): Song[] {
  const bi = blockOrder.indexOf(block);
  const earlier: Set<string>[] = [];
  for (const c of claims.values()) {
    const ci = blockOrder.indexOf(c.block);
    if (ci < 0) continue;
    if (ci < bi || (ci === bi && c.seq < seq)) earlier.push(c.ids);
  }
  // v7.1.0 — a song is claimed by catalogue id AND by canonical identity, so the film
  // cut, the remaster and the lofi flip of one song never fill three shelves. (7.0 added
  // this to dedupeShelves.ts, which Home does not use — this ledger is what Home uses.)
  const own = new Set<string>();
  const repeats: Song[] = [];
  const out = songs.filter((song) => {
    if (!song) return false;
    const key = `k:${songKey(song)}`;
    if (own.has(song.id) || own.has(key)) return false;
    for (const set of earlier) {
      if (set.has(song.id) || set.has(key)) {
        repeats.push(song);
        return false;
      }
    }
    own.add(song.id);
    own.add(key);
    return true;
  });
  claims.set(`${block}#${seq}`, { block, seq, ids: own });
  // Only a shelf that had a floor's worth of songs is protected; a short one keeps the strict rule.
  if (out.length >= floor || !repeats.length || songs.length < floor) return out;
  // Take back earlier shelves' songs, in this shelf's own order, up to the floor.
  const back = new Set(repeats.slice(0, floor - out.length).map((s) => s.id));
  return songs.filter((s) => s && (own.has(s.id) || back.has(s.id))).filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
}

/**
 * Per-render de-duper for one block. Call it at the top of the block's
 * render; call the returned function once per shelf, in display order.
 */
export function useShelfDedupe(block: string): (songs: Song[]) => Song[] {
  beginBlock(block);
  let seq = 0;
  return (songs) => claimShelf(block, seq++, songs);
}
