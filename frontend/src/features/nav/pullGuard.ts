/**
 * 11.5.0 — who owns a downward drag.
 *
 * Pull-to-refresh listens on `window` (the gesture has to be judged before
 * anything else sees it), which meant it armed on EVERY touch that began
 * while the page scroller sat at the top — including touches inside a sheet,
 * a menu, the AI chat transcript or any other inner scroller. Those drags
 * were then `preventDefault()`ed as a pull: the inner list refused to move
 * and the screen read as frozen.
 *
 * A pull belongs to the page only when the finger lands on the page itself:
 * inside the app's scroller, not inside one of our overlays, and with no
 * scrollable element of its own between the finger and the scroller.
 */
import { OWN_OVERLAYS } from './wheelRescue';

/** An element that can take the drag itself (a list that has somewhere to go). */
function scrollsVertically(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

export function canStartPull(target: EventTarget | null, scroller: HTMLElement | null): boolean {
  if (!scroller || !(target instanceof Element)) return false;
  // Only from the very top, and only from a finger on the page.
  if (scroller.scrollTop > 0) return false;
  if (!scroller.contains(target)) return false;
  if (target.closest(OWN_OVERLAYS)) return false;
  for (let el: Element | null = target; el && el !== scroller; el = el.parentElement) {
    if (scrollsVertically(el)) return false;
  }
  return true;
}

/**
 * The axis a gesture committed to, decided ONCE per touch and never revised:
 * a swipe that starts sideways (a shelf rail, the handoff swipe) stays
 * sideways for its whole life, so it can never turn into a pull halfway
 * through. Below the dead zone the gesture has not committed yet.
 */
export const AXIS_DEADZONE = 8;

export function gestureAxis(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_DEADZONE) return null;
  return ax > ay ? 'x' : 'y';
}
