import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryEntry, Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon, PlusIcon } from '@/components/Icons';
import { FALLBACK_ART, bestImage } from '@/utils/images';
import { songPath } from '@/utils/slug';
import { streakInfo } from '@/features/home/streak';
import { songOfTheDay } from '@/features/home/songOfTheDay';
import { localDateKey } from '@/features/home/useBecauseYouLiked';

/**
 * v5.17.0 — the two compact personal cards on Home: a listening streak with
 * its next milestone, and a song of the day. Both are pure functions of
 * on-device history/favourites; each hides itself when there is nothing to say.
 */
export function StreakCard({ entries }: { entries: HistoryEntry[] }) {
  const info = useMemo(() => streakInfo(entries), [entries]);
  if (info.days === 0) return null;
  const pct = Math.round(info.progress * 100);
  return (
    <Link
      to="/stats"
      aria-label={`${info.days}-day listening streak. Open your stats`}
      className="glass-card rounded-2xl p-4 flex items-center gap-3.5 hover:bg-ink-800/40 transition-colors min-w-0"
    >
      <span className="text-[30px] leading-none shrink-0" aria-hidden>🔥</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold leading-tight">{info.days}-day streak</span>
        <span className="block text-[11px] font-semibold text-ink-300 mt-0.5 truncate">
          {info.nextMilestone
            ? `${info.nextMilestone - info.days} more day${info.nextMilestone - info.days === 1 ? '' : 's'} to ${info.nextMilestone}`
            : 'Beyond every milestone'}
          {!info.todayCounts && ' · finish a song today'}
        </span>
        <span
          className="block h-1.5 mt-2 rounded-full bg-[var(--track)] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={info.nextMilestone ? `Progress to ${info.nextMilestone} days` : 'Streak progress'}
        >
          <span
            className="block h-full rounded-full transition-[width] duration-700"
            style={{ width: `${Math.max(6, pct)}%`, background: 'rgb(var(--ember-500))' }}
          />
        </span>
      </span>
    </Link>
  );
}

export function SongOfTheDayCard({ favorites, entries }: { favorites: Song[]; entries: HistoryEntry[] }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const dateKey = localDateKey();
  const pick = useMemo(() => songOfTheDay(favorites, entries, dateKey), [favorites, entries, dateKey]);
  if (!pick) return null;
  const { song, reason } = pick;
  return (
    <div className="glass-card rounded-2xl p-3 flex items-center gap-3 min-w-0">
      <Link to={songPath(song)} className="shrink-0" aria-label={`Open ${song.title}`}>
        <img
          src={bestImage(song.images, 150)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          loading="lazy"
          decoding="async"
          width={56}
          height={56}
          className="w-14 h-14 rounded-xl object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-extrabold tracking-[0.18em] uppercase text-ember-400">Song of the day</p>
        <p className="text-sm font-bold truncate">{song.title}</p>
        <p className="text-[11px] text-ink-400 truncate">{reason}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => playQueue([song], 0)}
          aria-label={`Play ${song.title}`}
          className="w-9 h-9 rounded-full btn-primary grid place-items-center active:scale-95 transition-transform"
        >
          <PlayIcon className="w-3.5 h-3.5 ml-0.5" />
        </button>
        <button
          type="button"
          onClick={() => enqueue(song)}
          aria-label={`Add ${song.title} to queue`}
          className="w-9 h-9 rounded-full btn-secondary grid place-items-center active:scale-95 transition-transform"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
