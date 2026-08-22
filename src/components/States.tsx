import type { ReactNode } from 'react';
import { WaveIcon } from './Icons';

function StateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-16">
      <div className="glass-panel rounded-3xl w-full max-w-sm px-8 py-12 flex flex-col items-center text-center gap-3">
        {children}
      </div>
    </div>
  );
}

function StateBadge() {
  return (
    <span className="flex items-center justify-center w-16 h-16 rounded-2xl glass-card text-ink-300">
      <WaveIcon className="w-8 h-8" />
    </span>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <StateShell>
      <StateBadge />
      <p className="mt-1 text-xl font-semibold">{title}</p>
      <p className="text-sm text-ink-300">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </StateShell>
  );
}

export function ErrorState({ retry, message }: { retry?: () => void; message?: string }) {
  return (
    <StateShell>
      <StateBadge />
      <p className="mt-1 text-xl font-semibold">Couldn’t reach the music servers</p>
      <p className="text-sm text-ink-300">
        {message ?? 'We can’t reach the music servers right now. This usually clears up on its own — check your connection or try again.'}
      </p>
      {retry && (
        <button
          onClick={retry}
          className="mt-2 px-5 py-2.5 rounded-full btn-primary active:scale-95 transition-transform"
        >
          Retry
        </button>
      )}
    </StateShell>
  );
}
