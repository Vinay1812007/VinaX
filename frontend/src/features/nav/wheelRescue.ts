/**
 * Wheel rescue (4.16.0, web): third-party scripts can park invisible fixed
 * elements directly under <body>, OUTSIDE #root. A wheel landing on one
 * scrolls nothing and the page looks frozen, so AppLayout forwards such a
 * wheel to <main>.
 *
 * v7.0.1 — "outside #root" stopped meaning "an injected blocker" in 7.0, when
 * VinaX's own menus and sheets were portalled to <body>: wheeling over the
 * song menu (or any sheet) scrolled the page behind it, and on the player
 * that scrolled the trigger away and closed the menu. The rescue now judges
 * the whole portal root the event came through, and leaves alone anything
 * that is ours or that an overlay already handled.
 */
export const OWN_OVERLAYS = '[role="menu"],[role="dialog"],[role="listbox"],[role="status"],[role="presentation"],[data-vx-overlay]';

export function shouldRescueWheel(target: EventTarget | null, root: Element | null, defaultPrevented: boolean): boolean {
  if (defaultPrevented || !root || !(target instanceof Node) || root.contains(target)) return false;
  let top: Node = target;
  while (top.parentNode && top.parentNode !== document.body) top = top.parentNode;
  return !(top instanceof Element && (top.matches(OWN_OVERLAYS) || top.querySelector(OWN_OVERLAYS) !== null));
}

/**
 * 11.5.0 — the same judgement for a TOUCH that lands on an injected blocker.
 * The wheel rescue only ever helped pointer devices: on a phone the identical
 * invisible fixed element under <body> swallows the drag and Home is frozen
 * with no way out (field reports: "the home screen does not scroll"). The
 * predicate is unchanged — anything of ours, or an event an overlay already
 * handled, is left alone — so only a blocker is ever rescued.
 */
export const shouldRescueTouch = shouldRescueWheel;
