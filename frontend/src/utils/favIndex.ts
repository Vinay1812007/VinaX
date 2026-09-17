import type { Song } from '@/types';

/**
 * O(1) "is this song a favourite?" for zustand SELECTORS.
 *
 * Every song row and card asks this on every library-store change; the old
 * `favorites.some(...)` made that O(rows × favourites). The library store
 * keeps its own id index behind `isFavorite()`, but it rebuilds that index
 * AFTER calling `set()` — and subscribers evaluate their selectors during
 * `set()`, so a selector built on it still sees the previous answer and the
 * heart never flips. This index is keyed on the identity of the `favorites`
 * array in the snapshot the selector was handed, so it can never be stale:
 * one Set build per favourites change, then a hash lookup per row.
 */
let indexedList: readonly Song[] | null = null;
let indexedIds: ReadonlySet<string> = new Set<string>();

export function isFavoriteIn(favorites: readonly Song[], id: string): boolean {
  if (favorites !== indexedList) {
    indexedList = favorites;
    indexedIds = new Set(favorites.map((s) => s.id));
  }
  return indexedIds.has(id);
}
