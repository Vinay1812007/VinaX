import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Reduce bottom margin for pages with inline content right after. */
  compact?: boolean;
}

/** Consistent expressive screen header — display title, compact subtitle. */
export function PageHeader({ title, subtitle, actions, compact }: Props) {
  return (
    <div className={`vx-page-header ${compact ? 'mb-1' : 'mb-6'}`}>
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle && <p className="text-meta text-ink-300 mt-1">{subtitle}</p>}
      </div>
      {/* The row wraps (.vx-page-header is flex-wrap) and so do the actions:
          a long title plus three buttons used to push off a phone screen. */}
      {actions && <div className="flex flex-wrap items-center gap-2 max-w-full">{actions}</div>}
    </div>
  );
}
