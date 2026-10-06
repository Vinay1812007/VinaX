import { Link } from 'react-router-dom';
import { FlowIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';

/**
 * 10.1 — the way into Flow from Home and Discover: one quiet card. Utility
 * classes only, so it adds nothing to those pages' stylesheets (Flow's own
 * styles ship with the Flow page).
 */
export function FlowEntryCard({ className }: { className?: string }) {
  return (
    <Link
      to="/flow"
      className={cn(
        'group relative flex items-center gap-4 my-6 p-4 pr-5 rounded-[var(--vx-radius-panel)] overflow-hidden',
        'bg-ink-850 border border-ink-700/70 hover:border-ember-500/60 transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-500',
        className,
      )}
    >
      <span
        aria-hidden
        className="grid place-items-center w-12 h-12 shrink-0 rounded-2xl text-[var(--vx-on-accent)]"
        style={{ background: 'var(--vx-glow, rgb(var(--ember-500)))' }}
      >
        <FlowIcon className="w-6 h-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ink-100 font-bold text-[17px] leading-tight" style={{ fontFamily: 'var(--vx-font-display)' }}>
          Flow
        </span>
        <span className="block text-ink-300 text-sm leading-snug mt-0.5">Swipe through songs picked for you. Each one starts at its best part.</span>
      </span>
      <span className="shrink-0 rounded-full px-4 py-2 text-sm font-bold bg-ember-500 text-[var(--vx-on-accent)] group-hover:brightness-110">Start</span>
    </Link>
  );
}
