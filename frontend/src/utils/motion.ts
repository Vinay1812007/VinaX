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

// ---------------------------------------------------------------------------
// Design system v2 motion (styles/tokens.css › Motion). Scripted animation
// uses the same durations and curves as the CSS, and the same reduced-motion
// answer, so nothing a script moves can ignore the listener's setting.
// ---------------------------------------------------------------------------

/** Milliseconds per duration token (mirrors --dur-* in tokens.css). */
export const DURATION = { instant: 90, quick: 160, base: 240, slow: 360, page: 420 } as const;
export type DurationToken = keyof typeof DURATION;

/** The curve tokens, as CSS values a WAAPI `easing` accepts. */
export const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  spring: 'var(--ease-spring)',
  bounce: 'var(--ease-bounce)',
} as const;
export type EasingToken = keyof typeof EASING;

/** WAAPI cannot read a CSS variable, so the spring curves resolve here once. */
function resolveEasing(token: EasingToken): string {
  const v = EASING[token];
  if (!v.startsWith('var(')) return v;
  try {
    const name = v.slice(4, -1);
    const css = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (css && (typeof CSS === 'undefined' || CSS.supports?.('transition-timing-function', css) !== false)) return css;
  } catch {
    /* no computed style (tests, detached document) */
  }
  return EASING.enter;
}

export interface AnimateOptions {
  duration?: DurationToken | number;
  easing?: EasingToken;
  delay?: number;
  fill?: FillMode;
}

/**
 * Element.animate() on the design tokens. Returns null (and does nothing)
 * when motion is reduced or WAAPI is missing, so callers never branch on it:
 * the element simply stays in its final, CSS-defined state.
 */
export function animate(el: Element | null | undefined, keyframes: Keyframe[] | PropertyIndexedKeyframes, opts: AnimateOptions = {}): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== 'function' || reducedMotion()) return null;
  const { duration = 'base', easing = 'standard', delay = 0, fill = 'none' } = opts;
  try {
    return (el as HTMLElement).animate(keyframes, {
      duration: typeof duration === 'number' ? duration : DURATION[duration],
      easing: resolveEasing(easing),
      delay,
      fill,
    });
  } catch {
    return null;
  }
}

/** Delay for item `index` of a staggered reveal: `step` ms apart, capped so a long list never waits. */
export function stagger(index: number, step = 32, max = 8): number {
  return Math.min(Math.max(0, index), max) * step;
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void> };
};

/**
 * Runs `update` (a DOM / state change) inside a View Transition when the
 * browser has one and motion is allowed; otherwise runs it straight away.
 * Elements that share a `view-transition-name` before and after the update
 * morph into each other (the mini player's artwork into Now Playing's).
 * Resolves when the transition (or the plain update) is done.
 */
export function withViewTransition(update: () => void | Promise<void>): Promise<void> {
  const doc = (typeof document === 'undefined' ? null : document) as ViewTransitionDoc | null;
  if (!doc?.startViewTransition || reducedMotion() || doc.visibilityState === 'hidden') {
    return Promise.resolve(update()).then(() => undefined);
  }
  try {
    return doc.startViewTransition(update).finished.catch(() => undefined);
  } catch {
    return Promise.resolve(update()).then(() => undefined);
  }
}
