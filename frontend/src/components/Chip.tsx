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
        'min-h-touch px-4 py-2 rounded-full text-sm font-semibold border transition-[color,background-color,border-color,opacity,transform] whitespace-nowrap',
        active && tone === 'default' && 'bg-ember-500/15 border-ember-400/40 text-ember-400',
        active && tone === 'danger' && 'bg-red-500/10 border-red-500 text-[var(--vx-danger)]',
        !active && 'bg-ink-850 border-glass text-ink-300 hover:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}
