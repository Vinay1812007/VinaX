import { useMemo } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { activeLyricIndex } from '@/features/lyrics/activeLine';
import type { LrcLine } from '@/services/lyrics/lrclib';
import { cn } from '@/utils/cn';

/**
 * Lyric preview card: the line just sung (dim), the current line (bright)
 * and the next line (dim). Tapping opens the full lyrics view.
 *
 * v5.20.0 — FIXED height. Each row has a set line box (the current line is
 * clamped to two lines), and empty rows keep a placeholder, so the card
 * never grows or shrinks between lines and whatever sits under it stays put.
 *
 * 8.0 — the card takes the artwork's tint (`.vx-rail-lyrics-card`, player.css).
 */
export function LiveLyricLine({ lines, onOpen, className }: { lines: LrcLine[]; onOpen: () => void; className?: string }) {
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
    <button onClick={onOpen} className={cn('vx-rail-lyrics-card', className)} aria-label="Open lyrics">
      <span className="block mb-2 text-[13px] font-bold text-ink-100">Lyrics</span>
      <p className="h-5 leading-5 truncate" aria-hidden={!previous}>
        {previous ?? ' '}
      </p>
      <p className={cn('is-now h-[3rem] line-clamp-2 overflow-hidden my-1', !current && 'opacity-60')}>{current ?? '♪'}</p>
      <p className="h-5 leading-5 truncate" aria-hidden={!upcoming}>
        {upcoming ?? ' '}
      </p>
    </button>
  );
}
