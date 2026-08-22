/**
 * Roadmap O.2 — the first live A/B experiment: home shelf order.
 *
 * 'control'         → today's order: personal/taste shelves first, then the
 *                     trending/discovery band (unchanged behavior).
 * 'discovery-first' → the discovery band (Trending Near You/Now, language
 *                     trending, New Releases, Popular, Fresh Finds, Hidden
 *                     Gems) moves ABOVE the taste shelves.
 *
 * The experiment is created/paused from the admin dashboard under this exact
 * key; until it exists there, every device resolves to 'control' and the home
 * page is byte-identical to before. Assignment is the deterministic on-device
 * hash from useExperiment — nothing extra is stored or sent (E2 contract).
 */

export const EXP_HOME_SHELF_ORDER = 'home-shelf-order';

export type HomeShelfOrder = 'control' | 'discovery-first';

/** Map a raw variant name to a layout, treating anything unknown (typos in
 *  admin config, future variants this build predates) as control. */
export function homeShelfOrder(variant: string): HomeShelfOrder {
  return variant === 'discovery-first' ? 'discovery-first' : 'control';
}
