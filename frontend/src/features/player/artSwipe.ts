/**
 * 8.1 — the artwork swipe on Now Playing: LEFT for the next song, RIGHT for
 * the previous one. Pure gesture arithmetic; the page only wires touch events
 * to a translate on the pane.
 *
 * A touch is undecided until the finger has travelled ~24px; then whichever
 * axis moved further owns it. A vertical drag is never claimed — the pane is
 * `touch-pan-y`, so the page scrolls as it would anywhere else (the old
 * up/down fling fought the scroll on phones). A horizontal drag follows the
 * finger with a damped offset and, on release, changes the song past ~70px
 * or on a fast fling, otherwise snaps back.
 */
export const SWIPE_CLAIM_PX = 24;
export const SWIPE_COMMIT_PX = 70;
export const SWIPE_FLING_PX = 36;
export const SWIPE_FLING_MS = 260;
export const SWIPE_FOLLOW_MAX_PX = 56;

export interface ArtSwipe {
  x: number;
  y: number;
  t: number;
  /** Horizontal travel at the last move, once the gesture is horizontal. */
  dx: number;
  axis: 'x' | 'y' | null;
}

export const beginArtSwipe = (x: number, y: number, t = Date.now()): ArtSwipe => ({ x, y, t, dx: 0, axis: null });

/** Damped offset so the artwork lags the finger and never leaves its card far. */
export const swipeFollow = (dx: number): number => Math.sign(dx) * Math.min(Math.abs(dx) * 0.5, SWIPE_FOLLOW_MAX_PX);

/**
 * Feed a touchmove. Returns the offset to translate the artwork by, or null
 * while the gesture is undecided or once it is vertical (leave it to the page).
 */
export function moveArtSwipe(s: ArtSwipe, x: number, y: number): number | null {
  const dx = x - s.x;
  const dy = y - s.y;
  if (s.axis === null) {
    if (Math.abs(dx) < SWIPE_CLAIM_PX && Math.abs(dy) < SWIPE_CLAIM_PX) return null;
    s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  if (s.axis !== 'x') return null;
  s.dx = dx;
  return swipeFollow(dx);
}

/** Feed the touchend: 'next' / 'prev' changes the song, null snaps back. */
export function endArtSwipe(s: ArtSwipe, x: number, t = Date.now()): 'next' | 'prev' | null {
  if (s.axis !== 'x') return null;
  const dx = x - s.x;
  s.dx = dx;
  const fling = Math.abs(dx) >= SWIPE_FLING_PX && t - s.t <= SWIPE_FLING_MS;
  if (Math.abs(dx) < SWIPE_COMMIT_PX && !fling) return null;
  return dx < 0 ? 'next' : 'prev';
}
