import { usePlayerStore } from '@/store/playerStore';
import { formatDuration } from '@/utils/format';

interface Props {
  compact?: boolean;
  /** : full-width bar with the time labels underneath. */
  timesBelow?: boolean;
}

export function Seekbar({ compact = false, timesBelow = false }: Props) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);

  const pct = duration > 0 ? `${(Math.min(currentTime, duration) / duration) * 100}%` : '0%';

  const input = (
    <input
      type="range"
      aria-label="Seek"
      min={0}
      max={Math.max(duration, 1)}
      step={1}
      value={Math.min(currentTime, duration || 0)}
      onChange={(e) => seek(Number(e.target.value))}
      className="w-full"
      style={{ '--fill': pct } as React.CSSProperties}
    />
  );

  if (timesBelow) {
    return (
      <div className="w-full">
        {input}
        <div className="flex justify-between -mt-0.5">
          <span className="text-[11px] tabular-nums text-ink-400">{formatDuration(currentTime)}</span>
          <span className="text-[11px] tabular-nums text-ink-400">{formatDuration(duration)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full">
      {!compact && <span className="text-[11px] tabular-nums text-ink-300 w-10 text-right">{formatDuration(currentTime)}</span>}
      <span className="flex-1">{input}</span>
      {!compact && <span className="text-[11px] tabular-nums text-ink-300 w-10">{formatDuration(duration)}</span>}
    </div>
  );
}
