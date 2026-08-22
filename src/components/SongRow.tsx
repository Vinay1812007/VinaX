import type { Song } from '@/types';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
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

  // Feed the right-click context menu (idempotent; cheap map write).
  rememberCtxSong(song);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
      data-deter-context
      data-song-id={song.id}
      className={cn(
        'group flex items-center gap-3 px-2 py-2 rounded-xl cursor-pointer transition-all active:scale-[0.98]',
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
