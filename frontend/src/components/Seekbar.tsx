import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Scrubbing: while a pointer holds the thumb the value lives HERE, not in
  // the store. Seeking the audio element on every drag tick made playback
  // stutter and broadcast a store update per pixel; the bar now paints the
  // local value and commits ONE seek when the pointer lets go. Keyboard steps
  // (no pointer down) still seek immediately.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const pointerDown = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);

  const commit = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
    pointerDown.current = false;
    const value = scrubRef.current;
    scrubRef.current = null;
    setScrub(null);
    if (value != null) usePlayerStore.getState().seek(value);
  }, []);

  const onPointerDown = () => {
    if (pointerDown.current) return;
    pointerDown.current = true;
    // The release can land anywhere on screen, so listen on the window.
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', commit);
    detachRef.current = () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', commit);
    };
  };

  useEffect(() => () => detachRef.current?.(), []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (pointerDown.current) {
      scrubRef.current = value;
      setScrub(value);
    } else {
      usePlayerStore.getState().seek(value);
    }
  };

  const shown = scrub ?? Math.min(currentTime, duration || 0);
  const pct = duration > 0 ? `${(Math.min(shown, duration) / duration) * 100}%` : '0%';

  const input = (
    <input
      type="range"
      aria-label="Seek"
      aria-valuetext={`${formatDuration(shown)} of ${formatDuration(duration)}`}
      min={0}
      max={Math.max(duration, 1)}
      step={1}
      value={shown}
      onPointerDown={onPointerDown}
      onChange={onChange}
      className="w-full"
      style={{ '--fill': pct } as React.CSSProperties}
    />
  );

  if (timesBelow) {
    return (
      <div className="w-full">
        {input}
        <div className="flex justify-between -mt-0.5">
          <span className="text-[11px] tabular-nums text-ink-400">{formatDuration(shown)}</span>
          <span className="text-[11px] tabular-nums text-ink-400">{formatDuration(duration)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full">
      {!compact && <span className="text-[11px] tabular-nums text-ink-300 w-10 text-right">{formatDuration(shown)}</span>}
      <span className="flex-1">{input}</span>
      {!compact && <span className="text-[11px] tabular-nums text-ink-300 w-10">{formatDuration(duration)}</span>}
    </div>
  );
}
