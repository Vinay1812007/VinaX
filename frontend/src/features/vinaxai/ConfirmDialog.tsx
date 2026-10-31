/** VinaX AI — a small confirmation dialog (focus moves in, Escape cancels). */
import { useEffect, useRef, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';

interface Props {
  title: string;
  body: string;
  confirm: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ title, body, confirm, onConfirm, onCancel }: Props): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDismissOnBack(true, onCancel);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => back?.focus?.();
  }, []);
  return (
    <div className="vx-ai-scrim" onClick={onCancel}>
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="vx-ai-confirm-title"
        aria-describedby="vx-ai-confirm-body"
        className="vx-ai-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
          if (e.key === 'Tab') {
            const f = [...(box.current?.querySelectorAll<HTMLElement>('button') ?? [])];
            const i = f.indexOf(document.activeElement as HTMLElement);
            const n = (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
            e.preventDefault();
            f[n]?.focus();
          }
        }}
      >
        <h2 id="vx-ai-confirm-title">{title}</h2>
        <p id="vx-ai-confirm-body">{body}</p>
        <div className="vx-ai-dialog-row">
          <button ref={cancelRef} type="button" className="vx-ai-chip" onClick={onCancel}>Cancel</button>
          <button type="button" className="vx-ai-chip is-danger" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
