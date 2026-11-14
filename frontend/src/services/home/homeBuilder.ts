import type { HomeSection } from '@/services/recommendation/homeDesign';

/**
 * Home's shelf order for one generation (features/home/homeRefresh.ts),
 * decided once and frozen, so Home never moves while the listener is on it.
 * The order itself comes from the device (`orderHomeBlocks`, or the layout the
 * listener or the owner chose); this only remembers it per generation.
 */

let memo: { key: string; blocks: HomeSection[] } | null = null;

/** The order for `key` (generation and visible shelves): `order()` the first time, the same answer after. */
export function decideHomeOrder(key: string, order: () => HomeSection[]): HomeSection[] {
  if (memo?.key !== key) memo = { key, blocks: order() };
  return memo.blocks;
}

/** Forget the decision, so the next Home is ordered again ("Rebuild Home now", tests). */
export function resetHomeDecision(): void {
  memo = null;
}
