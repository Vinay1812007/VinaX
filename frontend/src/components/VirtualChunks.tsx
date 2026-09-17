import { Fragment, memo, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

const DEFAULT_CHUNK = 20;

/**
 * Index-free React keys for a list that may hold the same id twice (a queue,
 * a playlist): the first occurrence is keyed by the id alone, repeats get an
 * occurrence suffix. Unlike `${id}-${index}`, reordering or removing a row
 * leaves every other row's key — and therefore its DOM node, focus and
 * loaded artwork — untouched.
 */
export function occurrenceKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}#${n}`;
  });
}

interface Props<T> {
  items: readonly T[];
  /** Stable React key for a row. `index` is the row's position in `items`. */
  keyOf: (item: T, index: number) => string;
  /**
   * Renders one row. Pass a STABLE function (module-level or useCallback):
   * chunks are memoised on it, so an inline arrow re-renders every chunk.
   */
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated height of one row in px, including the gap to the next row. */
  rowHeight: number;
  chunkSize?: number;
  /** Extra classes for each chunk wrapper — typically the list's own `space-y-*`. */
  chunkClassName?: string;
}

/**
 * Dependency-free windowing for long lists.
 *
 * Rows are grouped into chunks of ~20 and each chunk is a
 * `content-visibility: auto` box (the `.cv-auto` utility) with an intrinsic
 * height estimated from `rowHeight`. The browser then skips style, layout and
 * paint for every chunk that is off screen — a 500-song list costs about as
 * much to lay out as the two or three chunks in view — while the scrollbar
 * stays honest (`auto` remembers each chunk's real height once it has been
 * rendered). Unlike scroll-position virtualisation every row stays in the
 * DOM: tab order, find-in-page, screen-reader navigation and anchor focus all
 * keep working, and there is no scroll listener to maintain.
 *
 * Returns a fragment, so the caller keeps its own container element (`<ul>`,
 * a `space-y` div, …). Chunk wrappers are `role="presentation"` so list
 * semantics pass straight through them. Lists that fit in one chunk are
 * rendered bare — identical DOM to a plain `.map()`.
 */
export function VirtualChunks<T>({ items, keyOf, renderItem, rowHeight, chunkSize = DEFAULT_CHUNK, chunkClassName }: Props<T>) {
  if (items.length <= chunkSize) {
    return <>{items.map((item, i) => <Fragment key={keyOf(item, i)}>{renderItem(item, i)}</Fragment>)}</>;
  }
  const chunks: ReactNode[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(
      <Chunk
        key={start}
        items={items as readonly unknown[]}
        start={start}
        end={Math.min(start + chunkSize, items.length)}
        keyOf={keyOf as (item: unknown, index: number) => string}
        renderItem={renderItem as (item: unknown, index: number) => ReactNode}
        rowHeight={rowHeight}
        className={chunkClassName}
      />,
    );
  }
  return <>{chunks}</>;
}

interface ChunkProps {
  items: readonly unknown[];
  start: number;
  end: number;
  keyOf: (item: unknown, index: number) => string;
  renderItem: (item: unknown, index: number) => ReactNode;
  rowHeight: number;
  className?: string;
}

function ChunkImpl({ items, start, end, keyOf, renderItem, rowHeight, className }: ChunkProps) {
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) rows.push(<Fragment key={keyOf(items[i], i)}>{renderItem(items[i], i)}</Fragment>);
  return (
    <div
      role="presentation"
      // -mx/px: content-visibility implies paint containment, which clips at
      // the box edge — the gutter keeps focus rings and row shadows visible.
      className={cn('cv-auto -mx-1 px-1', className)}
      style={{ containIntrinsicSize: `auto 0px auto ${(end - start) * rowHeight}px` }}
    >
      {rows}
    </div>
  );
}

/** A chunk only re-renders when one of ITS rows changed — not when a row elsewhere in the list did. */
const Chunk = memo(ChunkImpl, (a, b) => {
  if (
    a.start !== b.start || a.end !== b.end || a.keyOf !== b.keyOf || a.renderItem !== b.renderItem ||
    a.rowHeight !== b.rowHeight || a.className !== b.className
  ) return false;
  if (a.items === b.items) return true;
  for (let i = a.start; i < a.end; i++) if (a.items[i] !== b.items[i]) return false;
  return true;
});
