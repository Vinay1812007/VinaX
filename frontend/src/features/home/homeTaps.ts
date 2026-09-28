import type { HomeSection } from '@/services/recommendation/homeDesign';

/**
 * 8.2.0 — which Home block a tap landed in, without wrapping the blocks in
 * extra elements (a wrapper would change Home's layout and its entrance
 * animation). HomePage puts an invisible marker before each block
 * (`data-home-block="<key>"`) and an empty one after it
 * (`data-home-block=""`); the last marker before the tapped control names
 * its block. Taps on things between blocks (the quick actions, Customise
 * Home) land after an empty marker and count for nothing.
 */
export const HOME_BLOCK_ATTR = 'data-home-block';

export function blockForTap(root: Element, target: EventTarget | null): HomeSection | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest('a, button');
  if (!control || !root.contains(control)) return null;
  let block: string | null = null;
  for (const marker of root.querySelectorAll(`[${HOME_BLOCK_ATTR}]`)) {
    if (!(marker.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    block = marker.getAttribute(HOME_BLOCK_ATTR);
  }
  return (block || null) as HomeSection | null;
}
