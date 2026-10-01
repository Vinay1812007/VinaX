import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '@/store/playerStore';
import { originOf, ORIGIN_LABEL } from '@/features/queue/origin';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NextIcon } from './Icons';

const REMAINING_THRESHOLD = 30; // seconds left before the card appears

/**
 * Whole seconds left in the track, but ONLY while it is playing inside the
 * final stretch — `null` the rest of the time. Subscribing to this instead of
 * the raw clock means the card's component re-renders once a second for the
 * last 30 s of a song and not at all for the other ~90 % of the session.
 */
export function selectEndingIn(s: { currentTime: number; duration: number; isPlaying: boolean }): number | null {
  if (!s.isPlaying || s.duration <= 0) return null;
  const remaining = s.duration - s.currentTime;
  if (remaining <= 0 || remaining > REMAINING_THRESHOLD) return null;
  return Math.ceil(remaining);
}

/**
 * Floating "Up next" preview that slides in during the last 30 seconds of a
 * track, showing the song that will play next. Tap to skip to it. Hidden on
 * the full-screen player (which already lists the queue) and whenever the next
 * track isn't determined (shuffle / repeat-one).
 */
export function NextUpCard() {
  const { pathname } = useLocation();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const endingIn = usePlayerStore(selectEndingIn);

  const current = queue[index];
  const upcoming =
    shuffle || repeat === 'one'
      ? undefined
      : queue[index + 1] ?? (repeat === 'all' && queue.length > 1 ? queue[0] : undefined);

  if (endingIn === null || !upcoming || upcoming.id === current?.id || pathname === '/now-playing') return null;

  // 7.2 — say who queued it, in the same words the Queue page uses.
  const origin = ORIGIN_LABEL[originOf(upcoming.id)];

  return (
    // From 1280px it steps aside for the Now Playing panel (clamp(300px, 22vw, 340px) wide) instead of covering it.
    <div className="fixed right-3 sm:right-6 xl:right-[calc(clamp(300px,22vw,340px)+24px)] z-30 bottom-[calc(9rem+var(--safe-bottom))] sm:bottom-24 pointer-events-none">
      <button
        type="button"
        onClick={() => usePlayerStore.getState().next(true)}
        aria-label={`Up next: ${upcoming.title}${origin ? `, ${origin.toLowerCase()}` : ''}. Tap to play it now.`}
        className="pointer-events-auto rounded-2xl border border-glass bg-ink-850 shadow-[var(--vx-deck-shadow)] p-2 pr-3 flex items-center gap-3 w-64 sm:w-72 text-left animate-fade-up hover:bg-ink-800 active:scale-[0.98] transition-[transform,background-color] duration-150"
      >
        <img
          src={bestImage(upcoming.images, 80)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          className="w-12 h-12 rounded-card object-cover shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-ink-400 tabular-nums">
            Up next{origin ? ` · ${origin}` : ''} · {endingIn}s
          </span>
          <span className="block text-[14px] font-semibold text-ink-100 truncate">{upcoming.title}</span>
          <span className="block text-[13px] text-ink-400 truncate">{upcoming.subtitle}</span>
        </span>
        <span className="w-9 h-9 rounded-xl bg-ink-100 text-ink-950 grid place-items-center shrink-0" aria-hidden>
          <NextIcon className="w-4 h-4" />
        </span>
      </button>
    </div>
  );
}
