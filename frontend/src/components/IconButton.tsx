import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface Props {
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Defaults to `button` — an icon button inside a <form> must never submit it by accident. */
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Toggle buttons (shuffle, like…): pass the state so it is announced, not just tinted. */
  'aria-pressed'?: boolean;
  /** Disclosure buttons (menus, panels). */
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  children: ReactNode;
}

/** Standardized icon button: consistent hit area, alignment, and weight. */
export function IconButton({
  label,
  onClick,
  active,
  size = 'md',
  className,
  type = 'button',
  disabled,
  'aria-pressed': ariaPressed,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  children,
}: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors shrink-0',
        // Visual size scales, but the tap target stays >= 44px via padding box.
        
        size === 'sm' && 'w-11 h-11',
        size === 'md' && 'w-11 h-11',
        size === 'lg' && 'w-12 h-12',
        active ? 'text-ember-400' : 'text-ink-300 hover:text-ink-100',
        'hover:bg-ink-800',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
    >
      {children}
    </button>
  );
}
