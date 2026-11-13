import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { Spinner } from './Spinner';
import '@/styles/ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (an <svg>); sized to the label. */
  icon?: ReactNode;
  /** Trailing icon. */
  iconEnd?: ReactNode;
  /** Shows a spinner, keeps the width, blocks clicks and sets aria-busy. */
  busy?: boolean;
  /** Full width of its container. */
  block?: boolean;
}

/**
 * Design system v2 button (README.md › Design system › Primitives).
 * `type="button"` by default: a bare <button> inside a form submits it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconEnd, busy = false, block = false, type = 'button', className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn('vx-btn', `vx-btn--${variant}`, size !== 'md' && `vx-btn--${size}`, block && 'vx-btn--block', className)}
      {...rest}
    >
      {icon}
      {children}
      {iconEnd}
      {busy && <Spinner />}
    </button>
  );
});
