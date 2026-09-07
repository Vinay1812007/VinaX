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
        'px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-[color,background-color,border-color,opacity,transform] whitespace-nowrap active:scale-95',
        // ~32px visual height; the invisible ::after inset expands the HIT BOX
        // to ≥44px (IconButton's touch-pad pattern — audit P1-15) without
        // changing how chip rows look.
        'relative after:absolute after:inset-0 after:-m-[6px]',
        // v5.9.0 chips: a selected chip is white on black, the rest
        // sit as soft #282828 pills that brighten on hover.
        active && tone === 'default' && 'bg-ink-100 border-ink-100 text-ink-950',
        active && tone === 'danger' && 'bg-red-500/20 border-red-500 text-red-300',
        !active && 'bg-ink-800 border-transparent text-ink-100 hover:bg-ink-700',
      )}
    >
      {children}
    </button>
  );
}
