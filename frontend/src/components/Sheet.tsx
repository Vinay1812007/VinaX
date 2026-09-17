import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { cn } from '@/utils/cn';

export interface SheetProps {
  /** Defaults to true — most sheets only mount while they are open. */
  open?: boolean;
  /** Escape, hardware back and (unless disabled) a backdrop click. A sheet
   *  that must not be dismissed passes a callback that declines. */
  onClose: () => void;
  /** Id of the visible heading. Prefer this over `label`. */
  labelledBy?: string;
  /** Accessible name when the sheet has no visible heading to point at. */
  label?: string;
  /** Panel max width from `sm` up (full width bottom sheet below that). */
  size?: 'sm' | 'md' | 'lg' | '2xl';
  /** Panel padding. The bottom edge always clears the home indicator. */
  padding?: 'md' | 'lg';
  /** `scroll`: the panel itself scrolls. `column`: the panel is a flex column
   *  and one of its children owns the scrolling (pinned header / footer). */
  layout?: 'scroll' | 'column';
  /** Panel max height: `tall` = 92% of the viewport, `medium` = 85%. */
  maxHeight?: 'tall' | 'medium';
  /** Stacking tier. 70 is the default sheet tier; 60 sits under it (boot
   *  overlays), 80 above it (the update gate). */
  z?: 60 | 70 | 80;
  /** Backdrop paint. No default background is applied besides this one. */
  backdropClassName?: string;
  closeOnBackdrop?: boolean;
  /** Extra panel classes. `cn` does not merge conflicts — do not pass
   *  padding, max-width, max-height or radius here; use the props. */
  className?: string;
  children: ReactNode;
}

const SIZE = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg', '2xl': 'sm:max-w-2xl' } as const;
const PADDING = {
  md: 'p-5 pb-[max(1.25rem,var(--safe-bottom))] sm:pb-5',
  lg: 'p-6 pb-[max(1.5rem,var(--safe-bottom))] sm:pb-6',
} as const;
const MAX_HEIGHT = { tall: 'max-h-[92dvh]', medium: 'max-h-[85dvh]' } as const;
const Z = { 60: 'z-[60]', 70: 'z-[70]', 80: 'z-[80]' } as const;

// Body scroll lock is reference-counted: sheets stack (a confirm over a
// sheet), and the first one to close must not unlock the page for the rest.
let locks = 0;
let previousOverflow = '';
function lockBodyScroll(): () => void {
  if (locks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = previousOverflow;
  };
}

/**
 * The one overlay shell every sheet used to re-type: bottom sheet on phones,
 * centred dialog from `sm` up.
 *
 * Portalled to <body> on purpose — a sheet rendered inside a page sits inside
 * whatever containing block / stacking context the page happens to create
 * (an animated wrapper, a transformed card), so `fixed inset-0` stops meaning
 * "the viewport". In <body> it always does.
 *
 * Owns: dialog semantics, focus trap + focus return, Escape, hardware back,
 * backdrop dismissal, body scroll lock, the bottom safe-area inset and the
 * max-height / internal scroll.
 */
export function Sheet({
  open = true,
  onClose,
  labelledBy,
  label,
  size = 'md',
  padding = 'md',
  layout = 'scroll',
  maxHeight = 'tall',
  z = 70,
  backdropClassName = 'bg-black/60',
  closeOnBackdrop = true,
  className,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, onClose);
  useDismissOnBack(open, onClose);
  useEffect(() => (open ? lockBodyScroll() : undefined), [open]);

  if (!open) return null;
  return createPortal(
    <div
      // Marks this as VinaX's own overlay: AppLayout's wheel rescue must not scroll the page behind it.
      data-vx-overlay
      className={cn('fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-6', Z[z], backdropClassName)}
      // Portals still bubble through the REACT tree: without this, a backdrop
      // click also fires whatever clickable row the sheet was rendered inside.
      onClick={(e) => {
        e.stopPropagation();
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        className={cn(
          'w-full glass-modal rounded-t-3xl sm:rounded-3xl animate-fade-up overscroll-contain',
          SIZE[size],
          PADDING[padding],
          MAX_HEIGHT[maxHeight],
          layout === 'scroll' ? 'overflow-y-auto' : 'flex flex-col',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
