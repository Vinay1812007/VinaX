import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NextIcon } from './Icons';

const REMAINING_THRESHOLD = 30; // seconds left before the card appears

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
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const next = usePlayerStore((s) => s.next);

  const current = queue[index];
  const upcoming =
    shuffle || repeat === 'one'
      ? undefined
      : queue[index + 1] ?? (repeat === 'all' && queue.length > 1 ? queue[0] : undefined);

  const remaining = duration > 0 ? duration - currentTime : Infinity;
  const show =
    isPlaying &&
    !!upcoming &&
    upcoming.id !== current?.id &&
    pathname !== '/now-playing' &&
    remaining > 0 &&
    remaining <= REMAINING_THRESHOLD;

  if (!show || !upcoming) return null;

  return (
    <div className="fixed right-3 sm:right-6 z-30 bottom-[calc(9rem+env(safe-area-inset-bottom))] sm:bottom-24 pointer-events-none">
      <button
        type="button"
        onClick={() => next(true)}
        aria-label={`Up next: ${upcoming.title}. Tap to play it now.`}
        className="pointer-events-auto glass-card rounded-2xl p-2 pr-3 flex items-center gap-3 w-60 sm:w-64 text-left animate-fade-up active:scale-[0.98] transition-transform"
      >
        <img
          src={bestImage(upcoming.images, 80)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          className="w-12 h-12 rounded-xl object-cover shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ember-400">
            Up next · {Math.ceil(remaining)}s
          </span>
          <span className="block text-sm font-semibold truncate">{upcoming.title}</span>
          <span className="block text-xs text-ink-300 truncate">{upcoming.subtitle}</span>
        </span>
        <NextIcon className="w-5 h-5 text-ink-300 shrink-0" />
      </button>
    </div>
  );
}
