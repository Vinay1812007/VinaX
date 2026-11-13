import { cloneElement, isValidElement, useId, type ReactElement } from 'react';
import '@/styles/ui.css';

/**
 * Design system v2 tooltip: shows on hover (after a beat) and at once on
 * keyboard focus, and describes its trigger (aria-describedby). For a short
 * hint only — never the only place a control's name lives.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': id }) : children;
  return (
    <span className="vx-tip-wrap">
      {trigger}
      <span role="tooltip" id={id} className="vx-tip">
        {label}
      </span>
    </span>
  );
}
