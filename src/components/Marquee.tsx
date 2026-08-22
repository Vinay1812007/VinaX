import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

/** Auto-scrolling text — but only when it truly overflows its container.
 *  Short-enough titles render static, so nothing ever looks doubled or cut. */
export function Marquee({ text, className }: { text: string; className?: string }) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      setOverflowing(inner.scrollWidth > outer.clientWidth + 4);
    };
    measure();
    // Also react to CSS-driven layout changes (sidebar collapse/expand,
    // player-bar breakpoint swap) that don't trigger a window resize —
    // otherwise the marquee decision is stuck at whatever the first measure
    // saw (audit finding M7). ResizeObserver is available in every browser
    // VinaX targets; the window listener stays as a defensive fallback.
    const outer = outerRef.current;
    let ro: ResizeObserver | null = null;
    if (outer && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(outer);
    }
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [text]);

  return (
    <span ref={outerRef} className={cn('block overflow-hidden whitespace-nowrap', overflowing && 'marquee-mask', className)}>
      {overflowing ? (
        <span
          className="inline-block animate-marquee will-change-transform"
          style={{ animationDuration: `${Math.max(11, Math.round(text.length * 0.45))}s` }}
        >
          <span ref={innerRef}>{text}</span>
          <span className="inline-block w-16" aria-hidden />
          <span aria-hidden>{text}</span>
          <span className="inline-block w-16" aria-hidden />
        </span>
      ) : (
        <span ref={innerRef} className="inline-block max-w-full truncate align-top">
          {text}
        </span>
      )}
    </span>
  );
}
