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
        // 8.0.0 — a selected filter reads as a solid inverse pill (both themes: ink-100 is the text tier).
        active && tone === 'default' && 'bg-ink-100 border-ink-100 text-ink-950',
        active && tone === 'danger' && 'bg-red-500/10 border-red-500 text-[var(--vx-danger)]',
        // A translucent fill, so the chip reads on every surface (page, card, sheet).
        !active && 'vx-chip-idle border-transparent text-ink-100',
      )}
    >
      {children}
    </button>
  );
}
