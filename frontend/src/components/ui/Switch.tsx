import { useId, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import '@/styles/ui.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; the whole row toggles. */
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Design system v2 switch: a settings row with role="switch". */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };
  return (
    <div className={cn('vx-switch-row', className)} data-disabled={disabled || undefined} onClick={toggle}>
      <span className="vx-switch-text">
        <span id={`${id}-l`} className="vx-switch-label">{label}</span>
        {description && <span id={`${id}-d`} className="vx-switch-desc">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        className="vx-switch"
        // The row's click handler toggles; the button only needs to stop a double toggle.
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="vx-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}
