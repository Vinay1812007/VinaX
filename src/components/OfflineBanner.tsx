import { Link } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** Slim global banner shown only while the device is offline. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex items-center gap-3 rounded-2xl glass-card px-4 py-3 text-sm animate-fade-up"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
          style={{ background: '#fbbf24' }}
        />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: '#fbbf24' }} />
      </span>
      <span className="min-w-0 flex-1 text-ink-200">
        You&rsquo;re offline &mdash; playing from{' '}
        <Link to="/offline" className="font-semibold text-ember-400 hover:text-ember-300">
          downloads
        </Link>
        . Library, favorites and history still browse with artwork.
      </span>
    </div>
  );
}
