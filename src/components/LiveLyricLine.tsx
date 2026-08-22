import { useMemo } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { activeLyricIndex } from '@/features/lyrics/activeLine';
import type { LrcLine } from '@/services/lyrics/lrclib';
import { cn } from '@/utils/cn';

/**
 * lyric strip: the current synced line (highlighted) with the
 * next line ghosted underneath. Tapping opens the full lyrics view.
 */
export function LiveLyricLine({ lines, onOpen }: { lines: LrcLine[]; onOpen: () => void }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const song = useCurrentSong();
  const offset = useLyricsOffsetStore((s) => (song ? s.offsets[song.id] ?? 0 : 0));

  const [current, upcoming] = useMemo(() => {
    const idx = activeLyricIndex(lines, currentTime, offset);
    const cur = idx >= 0 ? lines[idx]?.text : null;
    const nxt = lines[idx + 1]?.text ?? null;
    return [cur, nxt];
  }, [lines, currentTime, offset]);

  if (!current && !upcoming) return null;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left mt-3 px-4 py-3.5 rounded-2xl bg-ink-950/30 hover:bg-ink-950/45 transition-colors"
      aria-label="Open lyrics"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Lyrics</span>
        <span className="text-[11px] font-semibold text-ember-300">Open ›</span>
      </div>
      <p className={cn('text-xl font-extrabold leading-snug transition-all', current ? 'vx-lyric-active' : 'vx-lyric-dim')}>
        {current ?? '♪'}
      </p>
      {upcoming && <p className="text-base vx-lyric-dim opacity-70 leading-snug mt-1.5 truncate">{upcoming}</p>}
    </button>
  );
}
