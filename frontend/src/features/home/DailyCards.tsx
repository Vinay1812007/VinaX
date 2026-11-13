import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryEntry, Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon, PlusIcon } from '@/components/Icons';
import { FALLBACK_ART, bestImage } from '@/utils/images';
import { songPath } from '@/utils/slug';
import { songOfTheDay } from '@/features/home/songOfTheDay';
import { localDateKey } from '@/features/home/useBecauseYouLiked';

/**
 * v5.17.0 — the song of the day, a compact personal card on Home: a pure
 * function of on-device history and favourites that hides itself when there
 * is nothing to say. (2.0 removed the listening-streak card beside it.)
 */
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
