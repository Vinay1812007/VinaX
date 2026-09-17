import { memo, useRef } from 'react';
import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { formatDuration } from '@/utils/format';
import { cn } from '@/utils/cn';
import { rememberCtxSong } from '@/utils/ctxSongs';
import { FavButton } from './FavButton';
import { TrackMenu } from './TrackMenu';

interface Props {
  song: Song;
  /** Full list context — clicking plays this list starting at `index`. */
  songs?: Song[];
  index?: number;
  showArt?: boolean;
}

/**
 * One row of a song list. Lists run to hundreds of these, so the row is
 * memoised and subscribes to exactly two BOOLEANS — "am I the current song"
 * and "am I audibly playing". Selecting the current song object (or the raw
 * isPlaying flag) re-rendered every row on every track change and every
 * play/pause; with boolean selectors only the rows whose answer flips do.
 * Store actions are read at call time instead of being subscribed to.
 *
 * Keyboard: the play target is a real <button> and the heart / menu are its
 * SIBLINGS, never nested inside it — Enter on the heart must not also play.
 */
function SongRowImpl({ song, songs, index, showArt = true }: Props) {
  const isCurrent = usePlayerStore((s) => s.queue[s.index]?.id === song.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying && s.queue[s.index]?.id === song.id);

  const onPlay = () => {
    const { playQueue } = usePlayerStore.getState();
    if (songs && index != null) playQueue(songs, index);
    else playQueue([song], 0);
  };
  // v5.17.0 — swipe on touch screens: right = add to queue, left = Listen Later.
  const sw = useRef({ x: 0, y: 0, on: false });
  const onTouchStart = (e: React.TouchEvent) => { sw.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: true }; };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!sw.current.on) return;
    const dx = e.touches[0].clientX - sw.current.x;
    if (Math.abs(e.touches[0].clientY - sw.current.y) > 30) { sw.current.on = false; e.currentTarget.style.transform = ''; return; }
    e.currentTarget.style.transform = Math.abs(dx) > 12 ? `translateX(${Math.max(-96, Math.min(96, dx * 0.6))}px)` : '';
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = '';
    if (!sw.current.on) return;
    sw.current.on = false;
    const dx = e.changedTouches[0].clientX - sw.current.x;
    const { toggleLater } = useLibraryStore.getState();
    if (dx > 80) { usePlayerStore.getState().enqueue(song); toast(`Queued “${song.title}”`); }
    else if (dx < -80) { toggleLater(song); toast('Saved to Listen Later', { action: { label: 'Undo', onClick: () => toggleLater(song) } }); }
  };


  // Feed the right-click context menu (idempotent; cheap map write).
  rememberCtxSong(song);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      data-deter-context
      data-song-id={song.id}
      className={cn(
        'vx-track-row group',
        isCurrent && 'is-current',
      )}
    >
      {index != null && <span className="vx-track-number" aria-hidden>{index + 1}</span>}
      <button type="button" className="vx-track-play" onClick={onPlay} aria-label={`Play ${song.title} by ${song.subtitle}`} aria-current={isCurrent ? 'true' : undefined}>
      {showArt && (
        <div className="relative w-11 h-11 shrink-0">
          <img
            src={bestImage(song.images, 150)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-11 h-11 rounded-lg object-cover"
          />
          {isPlaying && (
            <div className="absolute inset-0 rounded-lg bg-ink-950/60 flex items-end justify-center gap-0.5 pb-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 h-4 rounded-full animate-pulse-bar origin-bottom bg-gradient-to-t from-ember-400 to-tide-400"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium truncate', isCurrent && 'text-ember-400')}>
          {song.title}
          {song.explicit && <span className="ml-1.5 text-[9px] align-middle px-1 py-0.5 rounded bg-ink-600 text-ink-200">E</span>}
        </span>
        <span className="block text-meta text-ink-300 truncate">{song.subtitle}</span>
      </span>
      </button>
      <span className="vx-track-album hidden 2xl:block truncate">{song.album?.name}</span>
      <span className="hidden sm:block text-xs tabular-nums text-ink-400">
        {formatDuration(song.duration)}
      </span>
      <div className="flex items-center gap-1 hover-reveal">
        <FavButton song={song} />
        <TrackMenu song={song} />
      </div>
    </div>
  );
}

export const SongRow = memo(SongRowImpl);
