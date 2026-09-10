import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  /** Explainability tag — why this shelf exists. */
  explanation?: string;
  seeAllTo?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Shelf({ title, explanation, seeAllTo, action, children }: Props) {
  return (
    <section className="vx-shelf mb-8 reveal cv-auto">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          {explanation && <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 truncate">{explanation}</p>}
          <h2 className="text-[20px] md:text-[22px] font-extrabold tracking-[-0.02em] truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {seeAllTo && (
            <Link to={seeAllTo} className="px-3 py-1 rounded-full border border-glass bg-[var(--tile)] text-[11px] font-bold text-ink-200 hover:text-ink-100 hover:border-glass-strong transition-colors">
              Show all
            </Link>
          )}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-2 px-2 snap-x [&>*]:snap-start">{children}</div>
    </section>
  );
}
