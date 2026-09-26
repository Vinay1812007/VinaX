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
      className="mb-4 flex items-center gap-3 min-h-[48px] rounded-xl bg-ink-850 px-4 py-2 text-[14px] animate-fade-up"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 text-ink-200">
        You&rsquo;re offline. Your library still browses, and{' '}
        <Link to="/offline" className="font-semibold text-ink-100 underline underline-offset-2 decoration-ink-400 hover:decoration-ink-100">
          downloads
        </Link>{' '}
        still play.
      </span>
    </div>
  );
}
