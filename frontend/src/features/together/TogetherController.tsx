import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTogether } from '@/services/together/session';
import { runSession, tapToListen } from './engine';
import '@/styles/pages/together.css';

/**
 * Mounted by AppLayout (lazily) while a Listen Together session is live: runs
 * the sync engine for the whole app and, on every page but /together itself,
 * shows a small "Live" pill — so a host browsing for the next song and a
 * guest reading lyrics both stay in the room and can see that they are.
 */
export default function TogetherController(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const code = useTogether((s) => s.code);
  const status = useTogether((s) => s.status);
  const hostName = useTogether((s) => s.hostName);
  const count = useTogether((s) => s.listenerCount);
  const needsTap = useTogether((s) => s.needsTap);
  const { pathname } = useLocation();

  useEffect(() => {
    if (mode === 'idle' || !code) return;
    return runSession(mode, code);
  }, [mode, code]);

  if (mode === 'idle' || pathname === '/together') return null;

  const label =
    status === 'reconnecting'
      ? 'Reconnecting…'
      : mode === 'host'
        ? `Hosting · ${count} listening`
        : status === 'host-away'
          ? `${hostName ?? 'The host'} went quiet`
          : `Listening with ${hostName ?? 'the host'}`;

  return (
    <div className="vx-lt-pill" data-status={status} role="status">
      {needsTap ? (
        <button type="button" className="vx-lt-pill-tap" onClick={tapToListen}>
          <span className="vx-lt-dot" aria-hidden />
          Tap to start listening
        </button>
      ) : (
        <Link to="/together" className="vx-lt-pill-link" aria-label={`${label}. Open Listen Together`}>
          <span className="vx-lt-dot" aria-hidden />
          <span className="truncate-1">{label}</span>
          <span className="vx-lt-pill-code">{code}</span>
        </Link>
      )}
    </div>
  );
}
