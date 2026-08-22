import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { WaveIcon } from '@/components/Icons';

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
    <div className="glass-card rounded-3xl max-w-md mx-auto my-24 px-10 py-14 flex flex-col items-center justify-center text-center gap-4">
      <WaveIcon className="w-14 h-14 text-ink-500" />
      <p className="text-4xl font-bold">404</p>
      <p className="text-lg font-extrabold">This track skipped itself</p>
      <p className="text-sm text-ink-300">The page you’re looking for doesn’t exist or moved.</p>
      <Link to="/" className="px-5 py-2.5 rounded-full btn-primary">
        Back to Home
      </Link>
    </div>
  );
}
