import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
export function SectionHeader({ title, explanation, seeAllTo, action }: {title: string; explanation?: string; seeAllTo?: string; action?: ReactNode}) {
  return <div className="vx-section-header">
    <div className="min-w-0"><h2>{title}</h2>{explanation && <p>{explanation}</p>}</div>
    <div className="flex items-center gap-2 shrink-0">{action}{seeAllTo && <Link to={seeAllTo} className="vx-section-link">Show all</Link>}</div>
  </div>;
}
