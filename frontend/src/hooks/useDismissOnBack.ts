import { useEffect, useRef } from 'react';

/**
 * Overlay back-stack (delta audit P0-2). Android's hardware back used to pop
 * the ROUTE straight through any open sheet/menu — the user lost the page and
 * the overlay in one press. Every dismissible overlay registers a close
 * callback while open; the hardware-back handler (AppLayout) closes the
 * topmost overlay first and only touches history when nothing is open.
 * Dumb LIFO module stack — nothing re-renders on changes.
 */

type Close = () => void;

const stack: Close[] = [];

/** Register an open overlay. Returns an unregister fn (idempotent). */
export function pushOverlay(close: Close): () => void {
  stack.push(close);
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the topmost overlay, if any. True when one was closed. */
export function closeTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/**
 * While `open`, register this overlay with the hardware-back stack so
 * Android's back button closes it instead of popping the route. The close
 * callback is read through a ref so inline `onClose` props don't churn the
 * registration every render. Overlays that only mount while open pass `true`.
 */
export function useDismissOnBack(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return pushOverlay(() => closeRef.current());
  }, [open]);
}
