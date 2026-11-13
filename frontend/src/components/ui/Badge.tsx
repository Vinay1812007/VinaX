import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

/** Design system v2 badge: a small status pill. `live` pulses (not under reduced motion). */
export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'positive' | 'danger' | 'live'; children: ReactNode; className?: string }) {
  return <span className={cn('vx-badge', tone !== 'neutral' && `vx-badge--${tone}`, className)}>{children}</span>;
}
