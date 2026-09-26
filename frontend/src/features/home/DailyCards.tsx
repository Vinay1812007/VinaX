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
      className="vxh-card"
    >
      <span className="vxh-card-art is-count" aria-hidden>{info.days}</span>
      <span className="min-w-0 flex-1">
        <span className="vxh-card-title">{info.days}-day streak</span>
        <span className="vxh-card-sub">
          {info.nextMilestone
            ? `${info.nextMilestone - info.days} more day${info.nextMilestone - info.days === 1 ? '' : 's'} to ${info.nextMilestone}`
            : 'Beyond every milestone'}
          {!info.todayCounts && ' · finish a song today'}
        </span>
        <span
          className="vxh-card-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={info.nextMilestone ? `Progress to ${info.nextMilestone} days` : 'Streak progress'}
        >
          <span style={{ width: `${Math.max(6, pct)}%` }} />
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
    <div className="vxh-card">
      <Link to={songPath(song)} className="shrink-0" aria-label={`Open ${song.title}`}>
        <img
          src={bestImage(song.images, 150)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          loading="lazy"
          decoding="async"
          width={56}
          height={56}
          className="vxh-card-art"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="vxh-card-label">Song of the day</p>
        <p className="vxh-card-title">{song.title}</p>
        <p className="vxh-card-sub">{reason}</p>
      </div>
      <div className="vxh-card-actions">
        <button type="button" onClick={() => playQueue([song], 0)} aria-label={`Play ${song.title}`} className="vxh-round is-play">
          <PlayIcon />
        </button>
        <button type="button" onClick={() => enqueue(song)} aria-label={`Add ${song.title} to queue`} className="vxh-round">
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
