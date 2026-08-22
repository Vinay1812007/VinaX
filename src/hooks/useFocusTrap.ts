import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus management (delta audit P1-9), extracted from OnboardingSheet —
 * the one overlay that did all of this correctly. While `open`:
 *
 *  1. remembers the opener and RESTORES its focus on close,
 *  2. moves focus to the first focusable inside the dialog,
 *  3. traps Tab / Shift+Tab inside (capture-phase, so nothing behind the
 *     overlay ever sees keyboard focus),
 *  4. Escape calls `onClose`.
 *
 * The nine other overlays had none of this — worst was the destructive
 * "Erase everything" confirm, where Tab walked into the live app behind the
 * dialog and Enter could fire an unseen control.
 *
 * `onClose` is read through a ref: inline arrow props never re-attach the
 * listeners. Pass `open: true` for overlays that only mount while open.
 */
export function useFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose?: () => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    root?.querySelector<HTMLElement>(FOCUSABLE)?.focus?.();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && closeRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = dialogRef.current;
      if (!el) return;
      const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [open, dialogRef]);
}
