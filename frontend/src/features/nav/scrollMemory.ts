/**
 * Scroll restoration for the app's real scroller (delta audit P0-3).
 *
 * The browser can't restore scroll for us: the scroller is an overflow
 * `<main>` inside an overflow-hidden shell, and every route change remounts
 * the page content (fade-up keyed on pathname), collapsing the scroll height
 * to ~0 for a frame or three while cached queries rehydrate. So we remember
 * positions per history entry (location.key) and restore on POP — waiting
 * until the content is tall enough to hold the target before jumping, so the
 * restore never gets clamped by a half-rendered page.
 *
 * In-memory by design: positions live for the SPA session, which matches how
 * long the history entries themselves are meaningful. (A hard reload starts
 * a new feed anyway — restoring into different content would be wrong.)
 */

const positions = new Map<string, number>();

export function rememberScroll(locationKey: string, top: number): void {
  positions.set(locationKey, top);
}

export function recallScroll(locationKey: string): number {
  return positions.get(locationKey) ?? 0;
}

interface ScrollerLike {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Restore `target` once `el` can actually scroll that far, polling per
 * animation frame (content streams in from the query cache over the first
 * frames after mount). Falls back to "as far as possible" when the page
 * never regrows (e.g. a list that changed). Returns a cancel fn.
 * (Tests stub requestAnimationFrame — kept global to stay off the
 * first-load byte budget.)
 */
export function restoreWhenTall(el: ScrollerLike, target: number, maxTries = 60): () => void {
  let cancelled = false;
  let rafId = 0;
  let tries = 0;
  const attempt = () => {
    if (cancelled) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max >= target) {
      el.scrollTop = target;
      return;
    }
    if (++tries < maxTries) rafId = requestAnimationFrame(attempt);
    else el.scrollTop = Math.max(0, max); // best effort: bottom of what exists
  };
  attempt();
  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}
