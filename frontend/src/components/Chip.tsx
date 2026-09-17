import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface Props {
  active?: boolean;
  tone?: 'default' | 'danger';
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ active, tone = 'default', onClick, children }: Props) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative min-h-[36px] px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-[color,background-color,border-color,opacity,transform] whitespace-nowrap',
        // Medium chip: 36px to look at, 44px to hit — the pad extends the hit box 4px above and below.
        "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        active && tone === 'default' && 'bg-ember-500/15 border-ember-400/40 text-ember-400',
        active && tone === 'danger' && 'bg-red-500/10 border-red-500 text-[var(--vx-danger)]',
        !active && 'bg-ink-850 border-glass text-ink-300 hover:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}
