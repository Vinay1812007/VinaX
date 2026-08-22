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
        'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap active:scale-95',
        active && tone === 'default' && 'bg-ember-500 border-ember-500 text-black',
        active && tone === 'danger' && 'bg-red-500/20 border-red-500 text-red-300',
        !active && 'border-ink-600 text-ink-200 hover:border-ink-400 hover:bg-ink-800/40',
      )}
    >
      {children}
    </button>
  );
}
