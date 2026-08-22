import { useEffect, useMemo, useRef } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { activeLyricIndex } from '@/features/lyrics/activeLine';
import type { LrcLine } from '@/services/lyrics/lrclib';
import { cn } from '@/utils/cn';

interface Props {
  lines: LrcLine[];
  /** Live mode highlights + follows playback and seeks on click. */
  live: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<Props['size']>, { line: string; active: string }> = {
  sm: { line: 'text-base leading-relaxed', active: 'text-lg' },
  md: { line: 'text-lg leading-relaxed', active: 'text-xl' },
  lg: { line: 'text-2xl leading-relaxed', active: 'text-3xl' },
  xl: { line: 'text-3xl leading-relaxed', active: 'text-4xl' },
};

/** Nearest scrollable ancestor — so following lyrics never scrolls the page. */
function scrollContainerOf(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function SyncedLyrics({ lines, live, size = 'md', className }: Props) {
  const currentTime = usePlayerStore((s) => (live ? s.currentTime : 0));
  const seek = usePlayerStore((s) => s.seek);
  // The per-song sync nudge lives in ONE store and applies on EVERY live
  // surface — before v3.1.1 the full-screen player ignored it, so a saved
  // nudge only worked in karaoke and the lyrics page drifted apart.
  const song = useCurrentSong();
  const offset = useLyricsOffsetStore((s) => (live && song ? s.offsets[song.id] ?? 0 : 0));
  const containerRef = useRef<HTMLDivElement>(null);
  /** While the user is scrolling the lyrics themselves, pause auto-follow. */
  const userScrollUntil = useRef(0);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !live) return;
    const scroller = scrollContainerOf(root);
    if (!scroller) return;
    const markUserScroll = () => {
      userScrollUntil.current = Date.now() + 4000;
    };
    scroller.addEventListener('wheel', markUserScroll, { passive: true });
    scroller.addEventListener('touchmove', markUserScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', markUserScroll);
      scroller.removeEventListener('touchmove', markUserScroll);
    };
  }, [live]);

  const activeIndex = useMemo(
    () => (live ? activeLyricIndex(lines, currentTime, offset) : -1),
    [lines, currentTime, live, offset],
  );

  useEffect(() => {
    if (activeIndex < 0) return;
    if (Date.now() < userScrollUntil.current) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    if (!el) return;
    const scroller = scrollContainerOf(el);
    if (!scroller) return;
    // Scroll ONLY the lyrics container — scrollIntoView would also scroll
    // every ancestor (the whole page jumped to the lyrics card on seek).
    const cRect = scroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const target =
      scroller.scrollTop + (eRect.top - cRect.top) - scroller.clientHeight / 2 + eRect.height / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex]);

  // Progressive fill for the active line: 0→100% between this line's start
  // and the next line's timestamp (LRC is line-timed; the sweep approximates
  // word sync the way premium players do it).
  const fillPct = useMemo(() => {
    if (!live || activeIndex < 0) return 0;
    const line = lines[activeIndex];
    const start = line.t + offset;
    const gap = activeIndex + 1 < lines.length ? lines[activeIndex + 1].t + offset - start : 5;
    // Vocals usually end before the next timestamp (breaths, interludes) —
    // pace the sweep to an estimated singing duration from text length,
    // clamped to the real gap. ~85ms per glyph tracks Telugu syllables well.
    const est = Math.min(Math.max(1.2, line.text.length * 0.085), Math.max(1.2, gap));
    return Math.max(0, Math.min(100, ((currentTime - start) / est) * 100));
  }, [live, activeIndex, lines, currentTime, offset]);

  const sizes = SIZE_CLASSES[size];

  return (
    <div ref={containerRef} className={cn('space-y-1', className)}>
      {lines.map((line, i) => (
        <button
          key={`${line.t}-${i}`}
          data-line={i}
          onClick={() => live && seek(Math.max(0, line.t + offset))}
          disabled={!live}
          className={cn(
            'block w-full text-left rounded-xl px-3 py-1.5 transition-[color,background-color,border-color,opacity,transform] duration-300',
            live && 'hover:bg-ink-800/60',
            i === activeIndex
              ? cn('vx-lyric-active font-bold scale-[1.02] origin-left', sizes.active)
              : cn(
                  live && activeIndex >= 0 && i < activeIndex ? 'vx-lyric-passed' : 'vx-lyric-dim',
                  sizes.line,
                ),
          )}
        >
          {i === activeIndex && live && line.text ? (
            <span className="karaoke-fill" style={{ '--kfill': `${fillPct}%` } as React.CSSProperties}>
              {line.text}
            </span>
          ) : (
            line.text || '♪'
          )}
        </button>
      ))}
    </div>
  );
}
