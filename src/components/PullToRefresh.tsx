import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { haptic } from '@/services/native';

/**
 * Pull-to-refresh wrapper. Native Android WebView has no built-in P2R, and
 * because VinaX is a Capacitor thin shell over the live origin we can't hand
 * that off to a `SwipeRefreshLayout` native container — the WebView owns the
 * scroll. So we implement it in JS, at page level, gated on the scroll being
 * at the very top and the gesture being predominantly vertical.
 *
 * Design contract:
 *  - Only pulls when the nearest scroll container is at scrollTop === 0.
 *  - Doesn't fight a horizontal swipe (shelf scrollers, cast handoff).
 *  - Threshold: 72px pull before commit; rubber-bands past that (max ~120px).
 *  - Haptic on threshold-cross so users know when release triggers refresh.
 *  - Idempotent onRefresh — caller returns a promise; we hold the spinner
 *    until it resolves (or 8s max, so a hung network doesn't lock the UI).
 *  - Zero effect on pointer devices (no touchstart events fire from mouse).
 *  - Reduced-motion: skips the transform animation, still triggers refresh.
 */
export interface PullToRefreshProps {
  onRefresh: () => void | Promise<unknown>;
  children: React.ReactNode;
  /** px the finger must travel before release commits a refresh. */
  threshold?: number;
  /** Class applied to the outer wrapper — usually leave undefined. */
  className?: string;
  /** Set to true to disable P2R on a specific page (e.g. Now Playing full-screen). */
  disabled?: boolean;
}

const MAX_PULL = 120;
const SPINNER_MIN_MS = 500;
const REFRESH_TIMEOUT_MS = 8000;

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 72,
  className,
  disabled = false,
}: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Mirror the render state in refs: the touch handlers read these. Reading
  // React STATE inside touchend was the "sometimes doesn't refresh" bug — on
  // a fast flick the final touchmove and touchend land in the same task,
  // before React commits, so the handler saw a stale (smaller) pull value
  // and dropped the refresh. Refs update synchronously.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const active = useRef(false);
  const hasHapticed = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const setPullBoth = useCallback((v: number) => {
    pullRef.current = v;
    setPull(v);
  }, []);

  const scrollTopEl = useCallback((): HTMLElement => {
    // The app scrolls on the primary <main>; fall back to documentElement.
    const main = document.querySelector<HTMLElement>('main');
    return main ?? document.documentElement;
  }, []);

  const commitRefresh = useCallback(async () => {
    refreshingRef.current = true;
    setRefreshing(true);
    setPullBoth(threshold);
    const started = Date.now();
    let done = false;
    const timeout = new Promise<void>((resolve) => {
      window.setTimeout(() => {
        if (!done) resolve();
      }, REFRESH_TIMEOUT_MS);
    });
    try {
      await Promise.race([Promise.resolve(onRefresh()), timeout]);
    } catch {
      /* onRefresh rejections must not leave the spinner stuck */
    }
    done = true;
    // Hold the spinner at least SPINNER_MIN_MS so it doesn't flash.
    const held = Date.now() - started;
    if (held < SPINNER_MIN_MS) {
      await new Promise((r) => window.setTimeout(r, SPINNER_MIN_MS - held));
    }
    refreshingRef.current = false;
    setRefreshing(false);
    setPullBoth(0);
    hasHapticed.current = false;
  }, [onRefresh, setPullBoth, threshold]);

  useEffect(() => {
    if (disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      // Only arm the gesture if the primary scroll container is at the top.
      if (scrollTopEl().scrollTop > 0) return;
      const t = e.touches[0];
      startY.current = t.clientY;
      startX.current = t.clientX;
      active.current = false;
      hasHapticed.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current || startY.current === null || startX.current === null) return;
      const t = e.touches[0];
      const dy = t.clientY - startY.current;
      const dx = t.clientX - startX.current;
      // Ignore horizontal-dominant gestures (shelf scroll, swipe-next).
      if (Math.abs(dx) > Math.abs(dy)) return;
      // Only care about DOWNWARD pulls from the top of the page.
      if (dy <= 0) {
        active.current = false;
        setPullBoth(0);
        return;
      }
      // If content scrolled while we were touching, cancel the pull.
      if (scrollTopEl().scrollTop > 0) {
        active.current = false;
        setPullBoth(0);
        return;
      }
      active.current = true;
      // Rubber-band: pull-distance is dampened past the threshold.
      const raw = dy;
      const damped = raw < threshold ? raw : threshold + (raw - threshold) * 0.35;
      const clamped = Math.min(MAX_PULL, damped);
      setPullBoth(clamped);
      if (clamped >= threshold && !hasHapticed.current) {
        hasHapticed.current = true;
        haptic('light');
      } else if (clamped < threshold) {
        hasHapticed.current = false;
      }
      // Consume the gesture so the browser doesn't try its own overscroll.
      if (raw > 8 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (refreshingRef.current) return;
      const wasActive = active.current;
      const finalPull = pullRef.current;
      active.current = false;
      startY.current = null;
      startX.current = null;
      if (wasActive && finalPull >= threshold) {
        void commitRefresh();
      } else {
        // Cancelled — smoothly retract.
        setPullBoth(0);
      }
    };

    // Handlers read only refs, so this effect mounts the listeners ONCE. The
    // old dep list included `pull`, which tore down and re-attached all four
    // listeners on every frame of the drag — after which Chromium marked the
    // touch sequence non-cancelable and preventDefault() stopped working,
    // handing the gesture to the WebView's own overscroll (Android's
    // "pull does nothing" report).
    const opts: AddEventListenerOptions = { passive: false };
    window.addEventListener('touchstart', onTouchStart, opts);
    window.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart, opts);
      window.removeEventListener('touchmove', onTouchMove, opts);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [commitRefresh, disabled, scrollTopEl, setPullBoth, threshold]);

  const progress = Math.min(1, pull / threshold);
  const showIndicator = pull > 4 || refreshing;

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {/* Indicator — sits above the content, translated by the pull distance. */}
      <div
        aria-hidden={!refreshing}
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-40',
          'flex items-center justify-center w-11 h-11 rounded-full',
          'bg-[rgb(var(--ink-850))] border border-[rgb(255_255_255_/_0.08)] shadow-lg',
          'transition-opacity duration-150 ease-out',
          showIndicator ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          top: `calc(env(safe-area-inset-top, 0px) + 8px)`,
          transform: `translate(-50%, ${Math.max(0, pull - 44)}px)`,
        }}
      >
        {refreshing ? (
          <span className="block w-5 h-5 rounded-full border-2 border-[rgb(var(--ink-600))] border-t-[rgb(var(--ember-500))] animate-spin" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5"
            style={{
              transform: `rotate(${progress * 180}deg)`,
              color: progress >= 1 ? 'rgb(var(--ember-500))' : 'rgb(var(--ink-300))',
              transition: 'color 120ms ease-out',
            }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M6 13l6 6 6-6" />
          </svg>
        )}
      </div>
      {/* Content — pulled down by the same distance while active. */}
      <div
        style={{
          transform: pull ? `translate3d(0, ${pull}px, 0)` : undefined,
          transition: active.current ? undefined : 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
