/**
 * VinaX AI — close a popover or drawer on Escape, on a press outside it,
 * and on Android's back button (the app's overlay stack).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';

export function useDismiss(open: boolean, close: () => void, inside: Array<RefObject<HTMLElement | null>>): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  useDismissOnBack(open, close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && insideRef.current.some((r) => r.current?.contains(t))) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);
}

/** Arrow-key movement between the enabled items of a menu or listbox. */
export function moveFocus(container: HTMLElement | null, selector: string, dir: 1 | -1 | 'first' | 'last'): void {
  if (!container) return;
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => el.getAttribute('aria-disabled') !== 'true');
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = dir === 'first' ? 0 : dir === 'last' ? items.length - 1 : (i + dir + items.length) % items.length;
  items[next].focus();
}
