/**
 * VinaX AI — the keyboard shortcuts, in a small dialog (⌘/ or Ctrl+/, or
 * Settings → General → Keyboard shortcuts).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { CloseIcon } from './icons';
import { isMac, keyLabel, SHORTCUTS } from './shortcuts';

export function ShortcutsDialog({ onClose }: { onClose(): void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useDismissOnBack(true, onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => back?.focus?.();
  }, []);
  const mac = isMac();
  return (
    <div className="vx-ai-scrim" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vx-ai-keys-title"
        className="vx-ai-dialog vx-ai-keys"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Tab') { e.preventDefault(); box.current?.querySelector<HTMLElement>('button')?.focus(); }
        }}
      >
        <div className="vx-ai-keys-head">
          <h2 id="vx-ai-keys-title">Keyboard shortcuts</h2>
          <button type="button" className="vx-ai-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
        <dl className="vx-ai-keys-list">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="vx-ai-keys-row">
              <dt>{s.label}</dt>
              <dd aria-label={s.keys.map((k) => keyLabel(k, false)).join(' ')}>
                {s.keys.map((k) => <kbd key={k}>{keyLabel(k, mac)}</kbd>)}
              </dd>
            </div>
          ))}
          <div className="vx-ai-keys-row">
            <dt>Stop the reply being written</dt>
            <dd><kbd>Esc</kbd></dd>
          </div>
          <div className="vx-ai-keys-row">
            <dt>New line in a message</dt>
            <dd><kbd>{mac ? '⇧' : 'Shift'}</kbd><kbd>Enter</kbd></dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
