import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `button` makes the whole card one control; links pass `cardClass()` to <Link>. */
  as?: 'div' | 'section' | 'article' | 'button';
  tone?: 'default' | 'flat' | 'raised';
  padded?: boolean;
  children: ReactNode;
}

/** Class list for a card rendered by another component (a router <Link>). */
export function cardClass({ tone = 'default', padded = true }: { tone?: CardProps['tone']; padded?: boolean } = {}): string {
  return cn('vx-card', tone !== 'default' && `vx-card--${tone}`, padded && 'vx-card--pad');
}

/** Design system v2 card: one surface, one hairline, one radius. */
export function Card({ as = 'div', tone = 'default', padded = true, className, children, ...rest }: CardProps) {
  const Tag = as;
  const interactive = as === 'button' || !!rest.onClick;
  return (
    <Tag
      {...(as === 'button' ? { type: 'button' as const } : null)}
      data-interactive={interactive || undefined}
      className={cn(cardClass({ tone, padded }), className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
