import type { ReactNode } from 'react';
import { WaveIcon } from './Icons';

function StateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-16">
      <div className="w-full max-w-md px-4 py-8 flex flex-col items-center text-center gap-3">
        {children}
      </div>
    </div>
  );
}

/**
 * The illustration slot. Package F1: the badge now carries a faint tint of
 * the living-artwork colour (--art) so empty states feel part of the app
 * rather than a dead grey card. Pages pass a context icon (Heart for
 * Favorites, Clock for History, …); it falls back to the neutral wave.
 */
function StateBadge({ icon }: { icon?: ReactNode }) {
  return (
    <span
      className="flex items-center justify-center w-16 h-16 rounded-2xl bg-ink-850"
      style={{
        // A whisper of the artwork accent — 12% fill, 24% ring. Falls back to
        // a neutral slate when nothing is playing (--art defaults set in CSS).
        background: 'rgb(var(--art) / 0.10)',
        boxShadow: 'inset 0 0 0 1px rgb(var(--art) / 0.22)',
        color: 'var(--vx-accent-hover)',
      }}
      aria-hidden
    >
      {icon ?? <WaveIcon className="w-8 h-8" />}
    </span>
  );
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  /** Optional context illustration — defaults to the neutral wave. */
  icon?: ReactNode;
}) {
  return (
    <StateShell>
      <StateBadge icon={icon} />
      <p className="mt-1 text-xl font-semibold">{title}</p>
      <p className="text-sm text-ink-300">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </StateShell>
  );
}

export function ErrorState({
  retry,
  message,
  title,
  icon,
}: {
  retry?: () => void;
  message?: string;
  /** Optional heading override — defaults to the servers-unreachable copy. */
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <StateShell>
      <StateBadge icon={icon} />
      <p className="mt-1 text-xl font-semibold">{title ?? 'Couldn’t reach the music servers'}</p>
      <p className="text-sm text-ink-300">
        {message ?? 'We can’t reach the music servers right now. This usually clears up on its own — check your connection or try again.'}
      </p>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-2 px-5 py-2.5 rounded-full btn-primary active:scale-95 transition-transform"
        >
          Retry
        </button>
      )}
    </StateShell>
  );
}

/**
 * One SECTION of a page failed (a shelf, a list) while the rest of the page is
 * fine — a quiet row with a retry instead of the full-page ErrorState, which
 * would stack once per shelf. `label` names what is missing.
 */
export function InlineError({ label, retry }: { label?: string; retry: () => void }) {
  return (
    <div role="alert" className="mb-8 flex items-center justify-between gap-3 rounded-2xl border border-glass bg-[var(--tile)] px-4 py-2 text-sm text-ink-300">
      <span className="min-w-0">{label ? `Couldn’t load ${label}.` : 'Couldn’t load this section.'}</span>
      <button type="button" onClick={retry} className="btn-secondary shrink-0 px-4 text-xs min-h-[44px]">
        Retry
      </button>
    </div>
  );
}
