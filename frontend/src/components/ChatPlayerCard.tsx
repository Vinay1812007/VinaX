import { useMemo } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { activeLyricIndex, lyricsOffsetFor } from '@/features/lyrics/activeLine';
import { bestImage } from '@/utils/images';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from '@/components/Icons';

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Live mini-player inside a chat bubble — mirrors the real player: artwork,
 *  controls, a seekable bar, and the current lyric line singing along. */
export function ChatPlayerCard({ fallback }: { fallback: string }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const song = queue[index] ?? null;
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const lyrics = useSyncedLyrics(song);
  const lines = lyrics.data?.synced ?? null;
  const [curLine, nextLine] = useMemo(() => {
    if (!lines?.length) return [null, null] as const;
    const idx = activeLyricIndex(lines, currentTime, lyricsOffsetFor(song?.id));
    return [idx >= 0 ? (lines[idx]?.text ?? null) : null, lines[idx + 1]?.text ?? null] as const;
  }, [lines, currentTime, song?.id]);
  if (!song) return <p className="whitespace-pre-wrap leading-relaxed">{fallback}</p>;
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="w-72 max-w-full select-none">
      <div className="flex items-center gap-3">
        <img src={bestImage(song.images, 120)} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate flex items-center gap-1.5">
            {isPlaying && (
              <span className="vx-eq" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            )}
            <span className="truncate">{song.title}</span>
          </p>
          <p className="text-[11px] text-ink-400 truncate">{song.subtitle}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => prev()} aria-label="Previous song" className="p-1.5 text-ink-300 hover:text-ink-100 transition relative after:absolute after:inset-0 after:-m-[8px]">
            <PrevIcon className="w-4 h-4" />
          </button>
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-9 h-9 rounded-full bg-premium text-white flex items-center justify-center hover:scale-105 transition"
          >
            {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
          </button>
          <button onClick={() => next(true)} aria-label="Next song" className="p-1.5 text-ink-300 hover:text-ink-100 transition relative after:absolute after:inset-0 after:-m-[8px]">
            <NextIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[10px] text-ink-400 tabular-nums">
        <span>{fmt(currentTime)}</span>
        <button
          aria-label="Seek"
          className="relative flex-1 h-4 cursor-pointer before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
          onClick={(e) => {
            if (duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            seek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
          }}
        >
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/10" />
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-premium" style={{ width: `${pct}%` }} />
        </button>
        <span>{fmt(duration)}</span>
      </div>
      {(curLine ?? nextLine) != null && (
        <div className="mt-2 border-t border-glass-strong pt-2">
          {curLine != null && <p className="text-[13px] font-semibold text-ink-100 leading-snug truncate">{curLine}</p>}
          {nextLine != null && <p className="text-[11px] text-ink-400 leading-snug truncate">{nextLine}</p>}
        </div>
      )}
    </div>
  );
}
