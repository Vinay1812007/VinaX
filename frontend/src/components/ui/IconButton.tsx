import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name; also the hover title. Required: an icon has no text. */
  label: string;
  variant?: 'ghost' | 'tonal' | 'solid';
  /** 36 / 40 / 48 / 64 px; the hit box never drops under 44px. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Toggle buttons (like, shuffle): announced, not just tinted. */
  pressed?: boolean;
  children: ReactNode;
}

/** Design system v2 icon button. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', pressed, type = 'button', className, children, title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn('vx-ibtn', variant !== 'ghost' && `vx-ibtn--${variant}`, size !== 'md' && `vx-ibtn--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
});
