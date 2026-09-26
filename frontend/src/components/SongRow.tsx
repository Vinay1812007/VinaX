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
import { ClockIcon, PlayIcon } from './Icons';
import '@/styles/pages/tracklist.css';

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

  const numbered = index != null;
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
        isPlaying && 'is-playing',
        numbered && 'is-numbered',
        !showArt && 'no-art',
      )}
    >
      <button type="button" className="vx-track-play" onClick={onPlay} aria-label={`Play ${song.title} by ${song.subtitle}`} aria-current={isCurrent ? 'true' : undefined}>
        {numbered && (
          // The # column lives inside the play target: on hover it becomes a
          // play glyph, and on the playing row an equaliser.
          <span className="vx-track-number" aria-hidden>
            <span className="vx-track-index">{index + 1}</span>
            <PlayIcon className="vx-track-glyph" />
            {isPlaying && <Equalizer />}
          </span>
        )}
        {showArt && (
          <span className="vx-track-art">
            <img
              src={bestImage(song.images, 150)}
              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
              alt=""
              loading="lazy"
              decoding="async"
              width={40}
              height={40}
            />
            <span className="vx-track-art-over" aria-hidden>
              {isPlaying && <Equalizer />}
              <PlayIcon className="vx-track-art-glyph" />
            </span>
          </span>
        )}
        <span className="vx-track-text">
          <span className="vx-track-title">
            <span>{song.title}</span>
            {song.explicit && <span className="vx-explicit" title="Explicit">E</span>}
          </span>
          <span className="vx-track-sub">{song.subtitle}</span>
        </span>
      </button>
      <span className="vx-track-album">{song.album?.name}</span>
      <span className="vx-track-like hover-reveal"><FavButton song={song} /></span>
      <span className="vx-track-duration">{song.duration ? formatDuration(song.duration) : ''}</span>
      <span className="vx-track-more hover-reveal"><TrackMenu song={song} /></span>
    </div>
  );
}

/** Three quiet bars for the row that is audibly playing. */
function Equalizer() {
  return <span className="vx-eq" aria-hidden><i /><i /><i /></span>;
}

/**
 * Desktop column labels for a numbered track list (#, Title, Album, duration).
 * Decorative (each row's play button already names its song), so it is
 * hidden from assistive tech. Render it inside a `.vx-tracklist` wrapper so
 * the album column lines up with the rows.
 */
export function TrackListHead({ numbered = true, lead = 0, trail = 0 }: {
  numbered?: boolean;
  /** Width in px of controls a page renders BEFORE each row (a checkbox). */
  lead?: number;
  /** Width in px of controls a page renders AFTER each row (remove, reorder). */
  trail?: number;
}) {
  return (
    <div className={cn('vx-tracklist-head', !numbered && 'no-num')} aria-hidden>
      {lead > 0 && <span style={{ flex: `0 0 ${lead}px` }} />}
      {/* Same box as a SongRow, so the percentage album column lines up. */}
      <div className="h-row">
        {numbered && <span className="h-num">#</span>}
        <span className="h-title">Title</span>
        <span className="h-album">Album</span>
        <span className="h-btn" />
        <span className="h-dur"><ClockIcon /></span>
        <span className="h-btn" />
      </div>
      {trail > 0 && <span style={{ flex: `0 0 ${trail}px` }} />}
    </div>
  );
}

export const SongRow = memo(SongRowImpl);
