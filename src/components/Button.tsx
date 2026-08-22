import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

/**
 * The design system's button. The visual variants live in CSS
 * (`.btn-primary` / `.btn-secondary` / `.btn-premium` in styles/index.css) —
 * this wrapper exists so NEW call sites get the non-visual guarantees for
 * free: `type="button"` by default (a bare <button> inside a form submits
 * it), a busy state that keeps width and announces via aria-busy, and one
 * place to grow loading spinners or size variants later.
 *
 * Existing raw `class="btn-*"` call sites are valid design-system usage and
 * are NOT being mass-migrated (84 sites of pure churn); prefer <Button> in
 * new or touched code.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'premium';
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', busy = false, type = 'button', className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(`btn-${variant}`, busy && 'opacity-70 pointer-events-none', className)}
      {...rest}
    >
      {children}
    </button>
  );
});
