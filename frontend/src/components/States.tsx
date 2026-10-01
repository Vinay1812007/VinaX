import type { ReactNode } from 'react';
import { WaveIcon } from './Icons';

/**
 * 8.0 — the empty / error pattern: an icon in a quiet badge, a title, one
 * muted line and at most one action. Centred in the workspace, no card.
 * 9.0 — the badge is an Iris-washed squircle.
 */
function StateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-14 sm:py-20">
      <div className="w-full max-w-sm flex flex-col items-center text-center">{children}</div>
    </div>
  );
}

/** The icon slot. Pages pass a context icon (heart for Favorites, clock for History…); defaults to the wave. */
function StateBadge({ icon }: { icon?: ReactNode }) {
  return (
    <span
      // 9.0.0 — Encore: a squircle with a quiet Iris wash.
      className="flex items-center justify-center w-16 h-16 rounded-sheet bg-ember-500/[0.12] text-ember-400 [&>svg]:w-7 [&>svg]:h-7"
      aria-hidden
    >
      {icon ?? <WaveIcon className="w-7 h-7" />}
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
      <p className="mt-5 text-[19px] font-extrabold tracking-[-0.015em] text-ink-100">{title}</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-400">{message}</p>
      {action && <div className="mt-5">{action}</div>}
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
      <p className="mt-5 text-[19px] font-extrabold tracking-[-0.015em] text-ink-100">{title ?? 'Couldn’t reach the music servers'}</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-400">
        {message ?? 'Check your connection and try again.'}
      </p>
      {retry && (
        <button type="button" onClick={retry} className="mt-5 px-6 min-h-[44px] rounded-full btn-primary active:scale-[0.97] transition-transform">
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
    <div role="alert" className="mb-8 flex items-center justify-between gap-3 min-h-[56px] rounded-xl bg-ink-850 pl-4 pr-2 py-1.5 text-[14px] text-ink-300">
      <span className="min-w-0">{label ? `Couldn’t load ${label}.` : 'Couldn’t load this section.'}</span>
      <button type="button" onClick={retry} className="shrink-0 px-4 min-h-[44px] rounded-full text-[13px] font-bold text-ink-100 hover:bg-ink-800 transition-colors">
        Retry
      </button>
    </div>
  );
}
