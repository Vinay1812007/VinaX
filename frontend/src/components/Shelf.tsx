import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SectionHeader } from './SectionHeader';
import { scrollBehavior } from '@/utils/motion';
import { ChevronDownIcon } from './Icons';
import { IconButton } from './IconButton';

interface Props {
  title: string;
  /** Explainability tag — why this shelf exists. */
  explanation?: string;
  seeAllTo?: string;
  action?: ReactNode;
  children: ReactNode;
  layout?: 'rail' | 'grid';
}

export function Shelf({ title, explanation, seeAllTo, action, children, layout = 'rail' }: Props) {
  // Desktop paging: a horizontal rail has no mouse affordance without a
  // trackpad or shift+wheel, so from md up the header carries prev / next.
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft >= max - 1;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
  }, []);
  const count = Children.count(children);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
    // `count`: cards arriving change scrollWidth without resizing the rail.
  }, [measure, count, layout]);
  const page = (dir: -1 | 1): void => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: scrollBehavior() });
  };
  const scrollable = !(edges.atStart && edges.atEnd);

  return (
    // pointerenter re-measures: the section is content-visibility:auto, so a
    // shelf that was skipped at mount reports no overflow until it is rendered.
    <section className="vx-shelf cv-auto" onPointerEnter={measure}>
      <SectionHeader title={title} explanation={explanation} seeAllTo={seeAllTo} action={<>
        {scrollable && <div className="hidden md:flex items-center">
          <IconButton size="sm" label={`Scroll ${title} back`} onClick={() => page(-1)} disabled={edges.atStart}><ChevronDownIcon className="w-5 h-5 rotate-90" /></IconButton>
          <IconButton size="sm" label={`Scroll ${title} forward`} onClick={() => page(1)} disabled={edges.atEnd}><ChevronDownIcon className="w-5 h-5 -rotate-90" /></IconButton>
        </div>}
        {action}
      </>} />
      <div ref={railRef} className={`vx-media-rail ${layout === 'grid' ? 'vx-media-grid' : ''}`}>{children}</div>
    </section>
  );
}
