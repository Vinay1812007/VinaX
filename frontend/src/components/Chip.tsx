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
        // ~32px visual height; the invisible ::after inset expands the HIT BOX
        // to ≥44px (IconButton's touch-pad pattern — audit P1-15) without
        // changing how chip rows look.
        
        // v5.9.0 chips: a selected chip is white on black, the rest
        // sit as soft #282828 pills that brighten on hover.
        active && tone === 'default' && 'bg-ember-500/15 border-ember-400/40 text-ember-400',
        active && tone === 'danger' && 'bg-red-500/20 border-red-500 text-red-300',
        !active && 'bg-ink-850 border-glass text-ink-300 hover:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}
