import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  variant?: 'segmented' | 'underline';
  /** Id prefix for aria-controls; panels use `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
  className?: string;
}

/**
 * Design system v2 tabs. Arrow keys, Home and End move between tabs (roving
 * tabindex, automatic activation); the indicator slides on a spring.
 */
export function Tabs<T extends string>({ items, value, onChange, label, variant = 'segmented', idPrefix, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    const measure = () => setInd({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    // The first placement must not animate in from the left edge.
    const raf = requestAnimationFrame(() => setReady(true));
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(list);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [value, items.length]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      data-ready={ready}
      className={cn('vx-tabs', `vx-tabs--${variant}`, className)}
      onKeyDown={onKey}
    >
      {ind && <span aria-hidden className="vx-tabs-ind" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />}
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="vx-tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count != null && <span className="vx-tab-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
