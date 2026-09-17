import { useEffect, type ReactNode } from 'react';
import { XIcon } from '@/components/Icons';

export interface ToastState {
  /** Changes per toast so the timer restarts. */
  id: number;
  message: string;
  undo?: () => void;
}

/** One quiet line at the bottom of the chat, with Undo when the action can be
 *  taken back (deleting a chat, clearing them all). Goes away by itself. */
export function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }): ReactNode {
  useEffect(() => {
    const t = window.setTimeout(onDone, toast.undo ? 8000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.undo, onDone]);
  return (
    <div className="ai-toast ai-pop" role="status">
      <span className="min-w-0">{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          className="ai-toast-undo"
          onClick={() => {
            toast.undo?.();
            onDone();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={onDone} className="ai-icon-btn w-7 h-7 -mr-1.5">
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
