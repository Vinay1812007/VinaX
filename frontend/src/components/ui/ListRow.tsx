import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Artwork, an avatar or an icon. */
  leading?: ReactNode;
  /** Duration, a count, a menu button. */
  trailing?: ReactNode;
  onClick?: () => void;
  /** The playing / selected row. */
  current?: boolean;
  className?: string;
}

/** Design system v2 list row: leading · title / subtitle · trailing. */
export function ListRow({ title, subtitle, leading, trailing, onClick, current, className }: ListRowProps) {
  const body = (
    <>
      {leading && <span className="vx-row-lead">{leading}</span>}
      <span className="vx-row-body">
        <span className="vx-row-title">{title}</span>
        {subtitle && <span className="vx-row-sub">{subtitle}</span>}
      </span>
    </>
  );
  // A trailing control (a menu button) cannot sit inside the row's own button.
  if (!onClick) {
    return (
      <div className={cn('vx-row', className)} aria-current={current || undefined}>
        {body}
        {trailing && <span className="vx-row-trail">{trailing}</span>}
      </div>
    );
  }
  return (
    <div className={cn('vx-row p-0', className)} aria-current={current || undefined}>
      <button type="button" data-interactive className="vx-row flex-1 min-w-0" onClick={onClick} aria-current={current || undefined}>
        {body}
      </button>
      {trailing && <span className="vx-row-trail pr-3">{trailing}</span>}
    </div>
  );
}
