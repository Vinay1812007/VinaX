import { useEffect, useState, useRef } from 'react';
import { XIcon } from './Icons';
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/80 backdrop-blur-sm p-6" onClick={() => setOpen(false)}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-sm glass-modal rounded-3xl p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          <button aria-label="Close" onClick={() => setOpen(false)} className="p-1.5 text-ink-400 hover:text-ink-100">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <dl className="space-y-2.5">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <dt><kbd className="px-2 py-1 rounded-lg bg-ink-700 text-xs font-bold tabular-nums">{key}</kbd></dt>
              <dd className="text-sm text-ink-200 text-right">{desc}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
