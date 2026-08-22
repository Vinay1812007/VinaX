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
    <div className={`flex items-end justify-between gap-3 ${compact ? 'mb-1' : 'mb-6'}`}>
      <div className="min-w-0">
        <h1 className="text-3xl md:text-[34px] font-extrabold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-meta text-ink-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
