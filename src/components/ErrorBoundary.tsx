import { reportError } from '@/services/analytics/telemetry';
import { Component, type ReactNode } from 'react';
import { Link, useRouteError } from 'react-router-dom';
import { KEYS } from '@/constants/storage-keys';

/** Clear persisted player state (queue + resume positions) — the recovery
 *  hatch when corrupt persisted data keeps crashing the player chrome. */
function clearPlayerData(): void {
  try {
    window.localStorage.removeItem(KEYS.player);
    window.localStorage.removeItem('vinax.resume.v1');
  } catch {
    /* storage unavailable */
  }
}

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the pathname), a tripped boundary resets — so
   * navigating away from a crashed page shows the new page, not the stale
   * error UI (delta audit P1-16). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error): void {
    reportError('react', error?.message ?? 'render error');
    if (import.meta.env.DEV) console.error('[vinax:boundary]', error);
    // A failed lazy chunk rejects its import promise permanently — remounting
    // can never fix it. Reload once (guarded against loops) so fresh HTML and
    // the self-healing service worker can repair the module graph.
    const msg = String(error?.message ?? '');
    if (/dynamically imported|Loading chunk|MIME type|Failed to fetch/i.test(msg)) {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem('vinax.chunkReload') || 0);
      } catch {
        /* storage unavailable */
      }
      if (Date.now() - last > 45_000) {
        try {
          sessionStorage.setItem('vinax.chunkReload', String(Date.now()));
        } catch {
          /* reload anyway */
        }
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.error) {
      // Distinguish "an update was mid-publish and this page's chunk moved"
      // (the common, self-healing case during a deploy) from a real render
      // crash — the generic message made deploy-skew look like a broken app.
      const isChunk = /dynamically imported|Loading chunk|MIME type|Failed to fetch/i.test(
        String(this.state.error?.message ?? ''),
      );
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <p className="text-2xl font-semibold">
            {isChunk ? 'An update just went live' : 'Something hit a wrong note'}
          </p>
          <p className="text-ink-300 max-w-md">
            {isChunk
              ? 'VinaX was updating while this page loaded. Tap below to get the new version — your music and data are safe.'
              : 'A part of this page failed to render. Your music and data are safe.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-full btn-primary"
          >
            {isChunk ? 'Load the new version' : 'Try again'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Boundary for the always-mounted player chrome (PlayerBar, rail, next-up).
 * The route boundary can't protect these, so without this a corrupt persisted
 * queue crashed the ENTIRE shell on every route with no way back (DQA-03).
 * Self-recovery: on crash we clear the persisted player state, then offer a
 * one-tap reload that boots clean.
 */
interface PlayerBoundaryProps {
  children: ReactNode;
  /** Collapse to nothing on crash (for decorative chrome like the rail). */
  silent?: boolean;
}

export class PlayerErrorBoundary extends Component<PlayerBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    reportError('react', `player: ${error?.message ?? 'render error'}`);
    if (import.meta.env.DEV) console.error('[vinax:player-boundary]', error);
    // The crash almost certainly came from bad persisted state — drop it now
    // so even a manual refresh boots clean.
    clearPlayerData();
  }

  render() {
    if (this.state.error) {
      if (this.props.silent) return null;
      return (
        <div className="glass-navbar px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-300 min-w-0 truncate">The player hit a snag — a quick reload fixes it.</span>
          <button
            onClick={() => {
              clearPlayerData();
              window.location.reload();
            }}
            className="px-4 py-1.5 rounded-full btn-primary shrink-0"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Router-level error element. */
export function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error('[vinax:route]', error);
  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-4 bg-ink-900 text-ink-100">
      <p className="text-3xl font-bold">Off the beat</p>
      <p className="text-ink-300">This page failed to load.</p>
      <Link to="/" className="px-5 py-2.5 rounded-full btn-primary">
        Back to Home
      </Link>
      <button
        onClick={() => {
          clearPlayerData();
          window.location.assign('/');
        }}
        className="text-sm text-ink-400 underline underline-offset-4 hover:text-ink-200"
      >
        Still stuck? Reset player data and reload
      </button>
    </div>
  );
}
