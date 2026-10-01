import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { WaveIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

export default function NotFoundPage() {
  usePageTitle('Not Found');

  // The SPA answers unknown paths with HTTP 200, so tell crawlers explicitly
  // not to index this page (re-applied after the layout's robots effect runs).
  useEffect(() => {
    const apply = (): void => {
      let m = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (!m) {
        m = document.createElement('meta');
        m.name = 'robots';
        document.head.appendChild(m);
      }
      m.content = 'noindex,follow';
    };
    apply();
    const t = window.setTimeout(apply, 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="vx-empty-page">
      <span className="vx-empty-icon" aria-hidden>
        <WaveIcon className="w-9 h-9" />
      </span>
      <p className="vx-empty-code">Page not found</p>
      <h1>This page skipped itself</h1>
      <p>The page you’re looking for doesn’t exist or has moved.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Link to="/" className="inline-flex items-center px-6 rounded-full btn-primary !mt-0">
          Back to Home
        </Link>
        <Link to="/search" className="inline-flex items-center px-6 rounded-full btn-secondary">
          Search
        </Link>
      </div>
    </div>
  );
}
