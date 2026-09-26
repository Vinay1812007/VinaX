import { useEffect, useState, useRef } from 'react';
import { XIcon } from './Icons';
import { IconButton } from './IconButton';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['← / →', 'Seek −10s / +10s'],
  ['↑ / ↓', 'Volume up / down'],
  ['N / P', 'Next / previous track'],
  ['M', 'Mute / unmute'],
  ['S', 'Toggle shuffle'],
  ['R', 'Cycle repeat'],
  ['F', 'Favorite current track'],
  ['?', 'This help'],
];

/** Keyboard shortcuts overlay — opens with "?" or from Settings. */
export function ShortcutsModal() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, () => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === '?') setOpen((v) => !v);
      if (e.key === 'Escape') setOpen(false);
    };
    const onEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('vinax:shortcuts', onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('vinax:shortcuts', onEvent);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full sm:max-w-xl max-h-[88dvh] overflow-y-auto overscroll-contain bg-ink-950 dark:bg-ink-850 border border-[color:var(--vx-border)] rounded-t-2xl sm:rounded-2xl px-5 pt-5 pb-[max(1.25rem,var(--safe-bottom))] sm:p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.6)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="pt-1 text-[18px] font-[750] tracking-[-0.015em]">Keyboard shortcuts</h2>
          <IconButton label="Close" size="sm" onClick={() => setOpen(false)} className="-mr-1.5 bg-ink-100/[0.07]">
            <XIcon className="w-5 h-5" />
          </IconButton>
        </div>
        <dl className="grid sm:grid-cols-2 sm:gap-x-8">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-4 min-h-[44px] border-b border-[color:var(--vx-border)]">
              <dt className="text-[14px] font-medium text-ink-200">{desc}</dt>
              <dd className="flex items-center gap-1 shrink-0">
                {key.split(' / ').map((k) => (
                  <kbd key={k} className="min-w-[26px] h-[26px] px-1.5 inline-flex items-center justify-center rounded-md bg-ink-100/[0.08] border border-[color:var(--vx-border)] text-[12px] font-bold text-ink-100 tabular-nums">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
