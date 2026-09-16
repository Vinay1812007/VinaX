import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { TUNE_OPTIONS, type TuneIntent } from '@/services/recommendation/tune';
import { cn } from '@/utils/cn';

/**
 * v6.5.0 — "Tune this queue": one tap reshapes what plays next. The chips
 * ride the Queue page and the Now Playing extras; the intent stays active
 * until the next fresh play.
 */
export function TuneChips({ className, compact = false }: { className?: string; compact?: boolean }) {
  const tuneQueue = usePlayerStore((s) => s.tuneQueue);
  const active = usePlayerStore((s) => s.tuneIntent);
  const hasSong = usePlayerStore((s) => s.queue.length > 0);
  if (!hasSong) return null;
  const tune = (intent: TuneIntent, label: string): void => {
    tuneQueue(intent);
    toast(intent === 'surprise' ? 'Surprise coming up ✦' : `${label} — retuning what's next`);
  };
  return (
    <div className={cn('flex gap-2', compact ? 'overflow-x-auto pb-1 -mx-1 px-1' : 'flex-wrap', className)} role="group" aria-label="Tune this queue">
      {TUNE_OPTIONS.map((opt) => {
        const on = active === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => tune(opt.id, opt.label)}
            aria-pressed={on}
            aria-label={`Tune queue: ${opt.label}`}
            className={cn(
              'shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition active:scale-95',
              opt.id === 'surprise' ? 'text-ink-100 border-ember-400/30 bg-ember-400/15 hover:bg-ember-400/25' : on ? 'bg-ember-400/20 text-ember-300 border-ember-400/40' : 'bg-ink-800/70 text-ink-200 border-white/5 hover:bg-ink-700 hover:text-ink-100',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
