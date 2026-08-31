import { useEffect, useRef, useState } from 'react';
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

interface TimeAnchor {
  t: number;
  at: number;
  playing: boolean;
}

/**
 * v5.6.0 — Apple-Music-smooth karaoke fill. The store ticks currentTime a few
 * times a second; animating the sweep off those ticks looked steppy and lagged
 * the voice. The active line now runs its own requestAnimationFrame loop that
 * interpolates wall-clock time from the last store tick and writes --kfill
 * straight to the span's style — 60fps, zero React re-renders.
 */
function KaraokeLine({ text, start, est, anchor }: { text: string; start: number; est: number; anchor: React.MutableRefObject<TimeAnchor> }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = anchor.current;
      const t = a.t + (a.playing ? (performance.now() - a.at) / 1000 : 0);
      const pct = Math.max(0, Math.min(100, ((t - start) / est) * 100));
      spanRef.current?.style.setProperty('--kfill', `${pct.toFixed(1)}%`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, start, est, anchor]);
  return (
    <span ref={spanRef} className="karaoke-fill" style={{ '--kfill': '0%' } as React.CSSProperties}>
      {text}
    </span>
  );
}

export function SyncedLyrics({ lines, live, size = 'md', className }: Props) {
  const currentTime = usePlayerStore((s) => (live ? s.currentTime : 0));
  const isPlaying = usePlayerStore((s) => (live ? s.isPlaying : false));
  const seek = usePlayerStore((s) => s.seek);
  // The per-song sync nudge lives in ONE store and applies on EVERY live
  // surface — before v3.1.1 the full-screen player ignored it, so a saved
  // nudge only worked in karaoke and the lyrics page drifted apart.
  const song = useCurrentSong();
  const offset = useLyricsOffsetStore((s) => (live && song ? s.offsets[song.id] ?? 0 : 0));
  const containerRef = useRef<HTMLDivElement>(null);
  /** While the user is scrolling the lyrics themselves, pause auto-follow. */
  const userScrollUntil = useRef(0);
  /** Wall-clock anchor for rAF interpolation between store time ticks. */
  const anchor = useRef<TimeAnchor>({ t: 0, at: 0, playing: false });
  useEffect(() => {
    anchor.current = { t: currentTime, at: performance.now(), playing: isPlaying };
  }, [currentTime, isPlaying]);

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

  // The active line advances the moment its timestamp passes — driven by the
  // same interpolated clock as the fill, not the store's coarse ticks, so the
  // highlight lands ON the beat instead of up to a quarter-second after it.
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    if (!live) {
      setActiveIndex(-1);
      return;
    }
    let raf = 0;
    const tick = () => {
      const a = anchor.current;
      const t = a.t + (a.playing ? (performance.now() - a.at) / 1000 : 0);
      const idx = activeLyricIndex(lines, t, offset);
      setActiveIndex((prev) => (prev === idx ? prev : idx));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, lines, offset]);

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

  // Estimated singing duration for a line: text length paced (~85ms/glyph
  // tracks Telugu syllables well), clamped to the real gap to the next line.
  const estFor = (i: number): number => {
    const line = lines[i];
    const start = line.t + offset;
    const gap = i + 1 < lines.length ? lines[i + 1].t + offset - start : 5;
    return Math.min(Math.max(1.2, line.text.length * 0.085), Math.max(1.2, gap));
  };

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
            <KaraokeLine text={line.text} start={line.t + offset} est={estFor(i)} anchor={anchor} />
          ) : (
            line.text || '♪'
          )}
        </button>
      ))}
    </div>
  );
}
