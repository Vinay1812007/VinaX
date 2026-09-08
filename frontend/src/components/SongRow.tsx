import { useRef } from 'react';
import type { Song } from '@/types';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
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

export function SongRow({ song, songs, index, showArt = true }: Props) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const current = useCurrentSong();
  const isCurrent = current?.id === song.id;
  const isPlaying = usePlayerStore((s) => s.isPlaying) && isCurrent;

  const onPlay = () => {
    if (songs && index != null) playQueue(songs, index);
    else playQueue([song], 0);
  };
  // v5.17.0 — swipe on touch screens: right = add to queue, left = Listen Later.
  const enqueue = usePlayerStore((s) => s.enqueue);
  const toggleLater = useLibraryStore((s) => s.toggleLater);
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
    if (dx > 80) { enqueue(song); toast(`Queued “${song.title}”`); }
    else if (dx < -80) { toggleLater(song); toast('Saved to Listen Later', { action: { label: 'Undo', onClick: () => toggleLater(song) } }); }
  };


  // Feed the right-click context menu (idempotent; cheap map write).
  rememberCtxSong(song);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      data-deter-context
      data-song-id={song.id}
      className={cn(
        'group flex items-center gap-3 px-2 py-2 rounded-xl cursor-pointer transition-[color,background-color,border-color,opacity,transform] active:scale-[0.98]',
        isCurrent ? 'bg-ink-800' : 'hover:bg-ink-850',
      )}
    >
      {showArt && (
        <div className="relative w-11 h-11 shrink-0">
          <img
            src={bestImage(song.images, 150)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-11 h-11 rounded-lg object-cover transition-transform duration-300 group-hover:scale-[1.06]"
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
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium truncate', isCurrent && 'text-ember-400')}>
          {song.title}
          {song.explicit && <span className="ml-1.5 text-[9px] align-middle px-1 py-0.5 rounded bg-ink-600 text-ink-200">E</span>}
        </p>
        <p className="text-xs text-ink-300 truncate">{song.subtitle}</p>
      </div>
      <span className="hidden sm:block text-xs tabular-nums text-ink-400">
        {formatDuration(song.duration)}
      </span>
      <div className="flex items-center hover-reveal">
        <FavButton song={song} />
        <TrackMenu song={song} />
      </div>
    </div>
  );
}
