import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { setToastNavigator, useToastStore, type Toast } from '@/store/toastStore';

/** How long a dismissed snackbar takes to sink away (shell.css `vx-snack-out`). */
export const SNACK_EXIT_MS = 180;
/** Drag a snackbar down this far and let go to dismiss it. */
const SWIPE_PX = 36;

function lessMotion(): boolean {
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/** Hands the router to toast actions fired from outside React ("View" → /queue). */
function NavigatorBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setToastNavigator((to) => navigate(to));
    return () => setToastNavigator(null);
  }, [navigate]);
  return null;
}

/**
 * 10.1.0 — snackbars. A compact frosted pill (dark glass, white glass in the
 * light theme) that rises above the player and the tab bar: an optional
 * artwork thumbnail, the message, and at most one action. Two at most; each
 * leaves on its own after ~4 s, holds while hovered or focused, and goes
 * early on a downward swipe or Escape.
 */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  const inRouter = useInRouterContext();
  const region = useRef<HTMLDivElement>(null);

  // Dismissed snackbars stay mounted for the exit motion (not under either
  // reduced-motion switch), hidden from assistive tech while they go.
  const [shown, setShown] = useState(toasts);
  const [leaving, setLeaving] = useState<Toast[]>([]);
  if (shown !== toasts) {
    setShown(toasts);
    const gone = shown.filter((t) => !toasts.some((x) => x.id === t.id));
    if (gone.length && !lessMotion()) setLeaving((l) => [...l, ...gone]);
  }
  useEffect(() => {
    if (!leaving.length) return;
    const h = window.setTimeout(() => setLeaving([]), SNACK_EXIT_MS);
    return () => window.clearTimeout(h);
  }, [leaving]);

  // Dismissing the snackbar that holds focus removes the element, and with
  // it the blur that would have resumed the others' timers.
  const dismissFromInside = (id: number): void => {
    dismiss(id);
    resume();
  };

  // Escape dismisses the newest — unless a sheet or menu is open and the
  // key belongs to it.
  useEffect(() => {
    if (!toasts.length) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const inside = !!region.current?.contains(document.activeElement);
      if (!inside && document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      dismissFromInside(toasts[toasts.length - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissFromInside only closes over stable store actions
  }, [toasts]);

  // Swipe down to dismiss. Pointer capture starts only once the finger has
  // clearly moved, so a tap on the action button still lands on the button.
  const drag = useRef<{ id: number; y: number; dy: number; captured: boolean } | null>(null);
  const onPointerDown = (id: number) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id, y: e.clientY, dy: 0, captured: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    if (!d.captured && d.dy > 6) {
      d.captured = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (d.captured) {
      e.currentTarget.style.transform = `translateY(${d.dy}px)`;
      e.currentTarget.style.opacity = String(Math.max(0.2, 1 - d.dy / 120));
    }
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.captured) return;
    if (d.dy >= SWIPE_PX) {
      dismissFromInside(d.id);
    } else {
      e.currentTarget.style.transform = '';
      e.currentTarget.style.opacity = '';
    }
  };

  const items = [...toasts.map((t) => ({ t, out: false })), ...leaving.map((t) => ({ t, out: true }))].sort((a, b) => a.t.id - b.t.id);

  // The live region is ALWAYS in the DOM: a region that mounts together with
  // its first message is not announced by most screen readers. One polite
  // region for the stack — no per-toast role, which double-announced.
  // Newest at the bottom, nearest the thumb.
  return (
    <div
      ref={region}
      role="status"
      aria-live="polite"
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) resume();
      }}
      className="vx-snackbar-region"
    >
      {inRouter && <NavigatorBridge />}
      {items.map(({ t, out }) => (
        <div
          key={t.id}
          className={out ? 'vx-snack vx-mat-thick is-leaving' : 'vx-snack vx-mat-thick'}
          aria-hidden={out || undefined}
          onPointerDown={out ? undefined : onPointerDown(t.id)}
          onPointerMove={out ? undefined : onPointerMove}
          onPointerUp={out ? undefined : onPointerEnd}
          onPointerCancel={out ? undefined : onPointerEnd}
        >
          {t.image && <img className="vx-snack-art" src={t.image} alt="" width={36} height={36} decoding="async" />}
          <p className="vx-snack-text">{t.message}</p>
          {t.action && (
            <button
              type="button"
              tabIndex={out ? -1 : undefined}
              onClick={() => {
                t.action?.onClick();
                dismissFromInside(t.id);
              }}
              className="vx-snack-action"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
