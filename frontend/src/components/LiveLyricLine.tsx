import { useMemo } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { activeLyricIndex } from '@/features/lyrics/activeLine';
import type { LrcLine } from '@/services/lyrics/lrclib';
import { cn } from '@/utils/cn';

/**
 * Lyric strip: the line just sung (ghosted), the current line (highlighted)
 * and the next line (ghosted). Tapping opens the full lyrics view.
 *
 * v5.20.0 — FIXED height. Each row has a set line box (the current line is
 * clamped to two lines), and empty rows keep a placeholder, so the strip
 * never grows or shrinks between lines and the controls under it stay put.
 */
export function LiveLyricLine({ lines, onOpen }: { lines: LrcLine[]; onOpen: () => void }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const song = useCurrentSong();
  const offset = useLyricsOffsetStore((s) => (song ? s.offsets[song.id] ?? 0 : 0));

  const [previous, current, upcoming] = useMemo(() => {
    const idx = activeLyricIndex(lines, currentTime, offset);
    const prev = idx > 0 ? lines[idx - 1]?.text ?? null : null;
    const cur = idx >= 0 ? lines[idx]?.text : null;
    const nxt = idx >= 0 ? lines[idx + 1]?.text ?? null : lines[0]?.text ?? null;
    return [prev, cur, nxt];
  }, [lines, currentTime, offset]);

  if (!lines.length) return null;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left mt-3 px-4 py-3 rounded-2xl bg-ink-950/30 hover:bg-ink-950/45 transition-colors"
      aria-label="Open lyrics"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Lyrics</span>
        <span className="text-[11px] font-semibold text-ember-300">Open ›</span>
      </div>
      <p className="h-5 text-sm vx-lyric-dim opacity-60 leading-5 truncate" aria-hidden={!previous}>
        {previous ?? ' '}
      </p>
      <p
        className={cn(
          'h-[3.25rem] text-[1.15rem] font-extrabold leading-[1.625rem] line-clamp-2 overflow-hidden transition-[color,opacity]',
          current ? 'vx-lyric-active' : 'vx-lyric-dim',
        )}
      >
        {current ?? '♪'}
      </p>
      <p className="h-5 text-sm vx-lyric-dim opacity-70 leading-5 truncate" aria-hidden={!upcoming}>
        {upcoming ?? ' '}
      </p>
    </button>
  );
}
