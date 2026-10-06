import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import type { LrcLine } from '@/services/lyrics/lrclib';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { isFavoriteIn } from '@/utils/favIndex';
import { activeLyricIndex } from '@/features/lyrics/activeLine';
import { TrackMenu } from '@/components/TrackMenu';
import { HeartIcon, PauseIcon, PlayIcon, PlusIcon, ShareIcon } from '@/components/Icons';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { bestImage } from '@/utils/images';
import { songLine } from '@/utils/songLine';
import { artistPath } from '@/utils/slug';

/** Two taps closer than this (ms) are a double tap. */
const DOUBLE_TAP_MS = 280;
/** …and closer than this (px). */
const DOUBLE_TAP_PX = 40;

export interface FlowCardProps {
  song: Song;
  index: number;
  total: number;
  /** Within a couple of cards of the one on screen: render the artwork (the rest stay light). */
  near: boolean;
  /** The card on screen. */
  active: boolean;
  /** The preview window on this card, when it is the one previewing. */
  window: { start: number; end: number } | null;
  /** Synced lyrics for the card on screen. */
  lines: LrcLine[] | null;
  failed: boolean;
  /** Previews are off (Listen Together): no play controls. */
  locked: boolean;
  reduceMotion: boolean;
  hint: boolean;
  onTogglePlay: (song: Song) => void;
  onPlayFull: (song: Song) => void;
  onAddToQueue: (song: Song) => void;
  onShare: (song: Song) => void;
  onMoreLikeThis: (song: Song) => void;
  /** Double tap: likes (never un-likes). */
  onLike: (song: Song) => void;
}

/**
 * 10.1 Flow — one song, full height: the artwork as a blurred backdrop with
 * the sharp cover in the middle, the title in the display face, a live lyric
 * strip, a thin progress line and the action rail. A double tap anywhere off
 * the controls likes the song (a marigold heart blooms where the finger was);
 * a single tap pauses or plays.
 */
export const FlowCard = memo(function FlowCard(props: FlowCardProps) {
  const { song, index, total, near, active, failed, locked, reduceMotion, hint } = props;
  const line = useMemo(() => songLine(song), [song]);
  const art = near ? bestImage(song.images, 500) : '';
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const singleTimer = useRef<number | null>(null);
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const burstSeq = useRef(0);

  useEffect(() => () => {
    if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
  }, []);

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="menu"], [role="dialog"]')) return;
    const now = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      props.onLike(song);
      if (!reduceMotion) {
        const id = (burstSeq.current += 1);
        setBursts((b) => [...b, { id, x, y }]);
        window.setTimeout(() => setBursts((b) => b.filter((h) => h.id !== id)), 900);
      }
      return;
    }
    lastTap.current = { t: now, x, y };
    if (locked) return;
    if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null;
      props.onTogglePlay(song);
    }, DOUBLE_TAP_MS);
  };

  return (
    <article
      className="vx-flow-card"
      data-flow-index={index}
      aria-roledescription="song card"
      aria-label={`${line.title} by ${line.artist}, ${index + 1} of ${total}`}
      onPointerUp={onPointerUp}
    >
      {near && (
        <div className="vx-flow-bg" aria-hidden>
          <img src={art} alt="" decoding="async" />
        </div>
      )}
      <div className="vx-flow-col">
        <div className="vx-flow-stage">
          {near ? (
            <img className="vx-flow-art" src={art} alt="" width={500} height={500} decoding="async" draggable={false} />
          ) : (
            <div className="vx-flow-art is-empty" aria-hidden />
          )}
        </div>
        <div className="vx-flow-bottom">
          <div className="vx-flow-meta">
            <h2 className="vx-flow-title">{line.title}</h2>
            <p className="vx-flow-artists">
              {song.artists[0] ? (
                <Link to={artistPath(song.artists[0])}>{line.artist}</Link>
              ) : (
                line.artist
              )}
              {line.album && <span className="vx-flow-album"> · {line.album}</span>}
            </p>
            {active && props.lines && props.lines.length > 0 && <FlowLyrics lines={props.lines} songId={song.id} />}
            {failed ? (
              <p className="vx-flow-note" role="status">This song can't play right now.</p>
            ) : (
              !locked && (
                <div className="vx-flow-controls">
                  <FlowPlayButton song={song} onToggle={props.onTogglePlay} />
                  <button type="button" className="vx-flow-full" onClick={() => props.onPlayFull(song)}>
                    Play full song
                  </button>
                </div>
              )
            )}
          </div>
          <div className="vx-flow-rail" role="group" aria-label={`Actions for ${line.title}`}>
            <FlowLikeButton song={song} />
            <button type="button" className="vx-flow-action" aria-label={`Add ${line.title} to queue`} onClick={() => props.onAddToQueue(song)}>
              <PlusIcon className="w-6 h-6" />
              <span aria-hidden>Queue</span>
            </button>
            <button type="button" className="vx-flow-action" aria-label={`Share ${line.title}`} onClick={() => props.onShare(song)}>
              <ShareIcon className="w-6 h-6" />
              <span aria-hidden>Share</span>
            </button>
            {!locked && (
              <button type="button" className="vx-flow-action" aria-label={`More like ${line.title}`} onClick={() => props.onMoreLikeThis(song)}>
                <RadioGlyph className="w-6 h-6" />
                <span aria-hidden>More like this</span>
              </button>
            )}
            <span className="vx-flow-action vx-flow-menu">
              <TrackMenu song={song} label={`More options for ${line.title}`} />
            </span>
          </div>
        </div>
      </div>
      {active && props.window && <FlowProgress songId={song.id} start={props.window.start} end={props.window.end} />}
      {hint && (
        <p className="vx-flow-hint" aria-hidden>
          <span className="vx-flow-hint-chev" />
          <span className="vx-flow-hint-touch">Swipe up for the next song</span>
          <span className="vx-flow-hint-keys">Scroll or press ↓ for the next song</span>
        </p>
      )}
      {bursts.map((b) => (
        <span key={b.id} className="vx-flow-burst" style={{ left: b.x, top: b.y }} aria-hidden>
          <HeartIcon className="w-24 h-24" filled />
        </span>
      ))}
    </article>
  );
});

/** Play / pause for this card's song, always visible for anyone who can't swipe or tap the artwork. */
function FlowPlayButton({ song, onToggle }: { song: Song; onToggle: (song: Song) => void }) {
  const playing = usePlayerStore((s) => s.isPlaying && s.queue[s.index]?.id === song.id);
  return (
    <button type="button" className="vx-flow-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => onToggle(song)}>
      {playing ? <PauseIcon className="w-7 h-7" /> : <PlayIcon className="w-7 h-7" />}
    </button>
  );
}

function FlowLikeButton({ song }: { song: Song }) {
  const liked = useLibraryStore((s) => isFavoriteIn(s.favorites, song.id));
  return (
    <button
      type="button"
      className={liked ? 'vx-flow-action is-liked' : 'vx-flow-action'}
      aria-label={liked ? `Remove ${song.title} from favorites` : `Like ${song.title}`}
      aria-pressed={liked}
      onClick={() => useLibraryStore.getState().toggleFavorite(song)}
    >
      <HeartIcon key={String(liked)} className={liked ? 'w-6 h-6 heart-pop' : 'w-6 h-6'} filled={liked} />
      <span aria-hidden>{liked ? 'Liked' : 'Like'}</span>
    </button>
  );
}

/** The line being sung, with the one before and the one after (the clock subscription lives only here). */
function FlowLyrics({ lines, songId }: { lines: LrcLine[]; songId: string }) {
  const current = usePlayerStore((s) => (s.queue[s.index]?.id === songId ? s.currentTime : -1));
  const offset = useLyricsOffsetStore((s) => s.offsets[songId] ?? 0);
  // Only the song actually in the player sings (not a card the listener is just looking at).
  if (current < 0) return null;
  const idx = activeLyricIndex(lines, current, offset);
  const prev = idx > 0 ? lines[idx - 1]?.text : '';
  const now = idx >= 0 ? lines[idx]?.text : '';
  const next = idx >= 0 ? lines[idx + 1]?.text : lines[0]?.text;
  return (
    <div className="vx-flow-lyrics" aria-hidden>
      <p className="is-past">{prev || ' '}</p>
      <p className="is-now">{now || '♪'}</p>
      <p className="is-next">{next || ' '}</p>
    </div>
  );
}

/** A thin line across the bottom: how far through its preview window the song is. */
function FlowProgress({ songId, start, end }: { songId: string; start: number; end: number }) {
  const t = usePlayerStore((s) => (s.queue[s.index]?.id === songId ? s.currentTime : start));
  const p = end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 0;
  return (
    <div className="vx-flow-progress" role="progressbar" aria-label="Preview progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <span style={{ transform: `scaleX(${p})` }} />
    </div>
  );
}
