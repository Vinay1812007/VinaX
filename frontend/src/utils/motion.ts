/**
 * v7.0.0 — one answer to "should this move?". CSS animations are already
 * silenced by the reduce-motion kill-switch, but an explicit
 * `scrollIntoView({ behavior: 'smooth' })` ignores CSS, so every scripted
 * scroll asks here first. True for the OS setting or the in-app switch.
 */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (document.documentElement.classList.contains('reduce-motion')) return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Scroll behaviour that honours the listener's motion preference. */
export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}
