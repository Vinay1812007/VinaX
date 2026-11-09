import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { Link } from 'react-router-dom';
export function SectionHeader({ title, explanation, seeAllTo, action }: {title: string; explanation?: string; seeAllTo?: string; action?: ReactNode}) {
  const t = useT();
  return <div className="vx-section-header">
    <div className="min-w-0"><h2>{t(title)}</h2>{explanation && <p>{explanation}</p>}</div>
    <div className="flex items-center gap-2 shrink-0">{action}{seeAllTo && <Link to={seeAllTo} className="vx-section-link">{t('Show all')}</Link>}</div>
  </div>;
}
