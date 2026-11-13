import { useId, type ReactNode } from 'react';
import { Sheet, SheetHeader, type SheetProps } from '@/components/Sheet';
import '@/styles/ui.css';

export interface DialogProps extends Pick<SheetProps, 'open' | 'onClose' | 'size' | 'z' | 'closeOnBackdrop'> {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Buttons, primary LAST (it sits right on desktop, on top of the stack on phones). */
  actions?: ReactNode;
  /** Hide the close button (a dialog that must be answered). */
  hideClose?: boolean;
}

/**
 * Design system v2 dialog: the Sheet shell (focus trap, Escape, back, scroll
 * lock, bottom sheet on phones) with the standard header, body and actions.
 */
export function Dialog({ title, subtitle, children, actions, hideClose, size = 'sm', ...sheet }: DialogProps) {
  const id = useId();
  return (
    <Sheet {...sheet} size={size} labelledBy={`${id}-t`}>
      <SheetHeader id={`${id}-t`} title={title} subtitle={subtitle} onClose={hideClose ? undefined : sheet.onClose} />
      {children && <div className="vx-dialog-body">{children}</div>}
      {actions && <div className="vx-dialog-actions">{actions}</div>}
    </Sheet>
  );
}
