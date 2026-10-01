import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { TUNE_OPTIONS, type TuneIntent } from '@/services/recommendation/tune';
import { cn } from '@/utils/cn';

/**
 * v6.5.0 — "Tune this queue": one tap reshapes what plays next. The chips
 * ride the Queue page and the Now Playing extras; the intent stays active
 * until the next fresh play.
 *
 * 7.2 — the chips follow the medium control scale: 36px to look at, 44px to
 * hit (the invisible pad, as on `Chip`), and the hairline is a token so it
 * survives the light theme.
 */
export function TuneChips({ className, compact = false }: { className?: string; compact?: boolean }) {
  const tuneQueue = usePlayerStore((s) => s.tuneQueue);
  const active = usePlayerStore((s) => s.tuneIntent);
  const hasSong = usePlayerStore((s) => s.queue.length > 0);
  if (!hasSong) return null;
  const tune = (intent: TuneIntent, label: string): void => {
    tuneQueue(intent);
    toast(intent === 'surprise' ? 'Surprise coming up ✦' : `${label} — retuning what's next. Songs you added stay.`);
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
            // 9.0 — the Encore chip (shell.css): a quiet fill at rest, solid Iris when chosen;
            // "Surprise me" is a VinaX moment, so it carries a Lagoon tint.
            className={cn(
              "relative shrink-0 min-h-[36px] px-3.5 py-1.5 rounded-full text-[13px] font-semibold border whitespace-nowrap transition active:scale-95 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
              on
                ? 'vx-chip-on'
                : opt.id === 'surprise'
                  ? 'text-ink-100 border-tide-400/30 bg-tide-500/15 hover:bg-tide-500/25'
                  : 'vx-chip-idle border-transparent text-ink-100',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
