/**
 * 12.0 — a site's small logo, for the source chips, the Sources list, the
 * search steps and the Trending strip. It loads through the Worker
 * (/api/favicon), so the browser never asks a third party which sites an
 * answer cited; a site with no logo (or a failed load) shows its letter, as
 * before 12.0.
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { FAVICON_ENDPOINT } from './endpoints';

const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;

export function SiteMark({ host, letter, className }: { host: string; letter: string; className?: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  const h = (host ?? '').toLowerCase().replace(/^www\./, '');
  const logo = !failed && HOST.test(h);
  return (
    <span className={cn('ai-cite-mono', logo && 'has-logo', className)} aria-hidden>
      {logo ? (
        <img src={`${FAVICON_ENDPOINT}?host=${encodeURIComponent(h)}`} alt="" width={16} height={16} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        letter
      )}
    </span>
  );
}
