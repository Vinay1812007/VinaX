import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';

/**
 * 1.4 — Never repeat, on the queue: the same switch as Settings →
 * Recommendations. Turning it on rebuilds the automatic songs still to come,
 * so nothing already heard is waiting in Up Next; songs the listener queued
 * by hand stay where they are.
 *
 * The chip follows TuneChips' scale (36px to look at, 44px to hit) and its
 * visible text is its accessible name.
 */
export function NeverRepeatChip({ className }: { className?: string }) {
  const on = useSettingsStore((s) => !!s.neverRepeat);
  const setNeverRepeat = useSettingsStore((s) => s.setNeverRepeat);
  const regenerateAutoTail = usePlayerStore((s) => s.regenerateAutoTail);
  const hasSong = usePlayerStore((s) => s.queue.length > 0);
  const flip = (): void => {
    const next = !on;
    setNeverRepeat(next);
    if (next && hasSong) regenerateAutoTail();
    toast(next ? 'Never repeat is on — only songs you have not heard play next. Songs you added stay.' : 'Never repeat is off', { key: 'never-repeat' });
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={on}
      className={cn(
        "relative shrink-0 min-h-[36px] px-3.5 py-1.5 rounded-full text-[13px] font-semibold border whitespace-nowrap transition active:scale-95 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        on ? 'vx-chip-on' : 'vx-chip-idle border-transparent text-ink-100',
        className,
      )}
    >
      Never repeat
    </button>
  );
}
