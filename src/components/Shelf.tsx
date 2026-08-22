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
    <section className="mb-8 reveal cv-auto">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-extrabold tracking-tight truncate">{title}</h2>
          {explanation && <p className="text-xs text-ink-400 mt-0.5 truncate">{explanation}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {seeAllTo && (
            <Link to={seeAllTo} className="group/sa text-xs font-semibold text-ember-400 hover:text-ember-300 inline-flex items-center gap-0.5">
              See all
              <span aria-hidden className="inline-block transition-transform group-hover/sa:translate-x-0.5">›</span>
            </Link>
          )}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-2 px-2 snap-x [&>*]:snap-start">{children}</div>
    </section>
  );
}
