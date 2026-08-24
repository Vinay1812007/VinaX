import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useCastStore } from '@/services/cast';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { applyArtColor, extractAverageColor, extractVibrantColor } from '@/utils/color';
import { cn } from '@/utils/cn';
import { Seekbar } from './Seekbar';
import { FavButton } from './FavButton';
import { IconButton } from './IconButton';
import { Marquee } from './Marquee';
import {
  ClockIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  VolumeIcon,
} from './Icons';

// Progress hairline lives in its own component so the ~4×/s currentTime and
// duration updates re-render only this hairline — not the full PlayerBar with
// its icons, marquee, and volume slider. Cuts a lot of wasted work on mobile.
function ProgressHairline() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-full bg-white/20">
      <div className="h-full rounded-full bg-white transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
    </div>
  );
}

export function PlayerBar() {
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  // Subscribe to the actions selectorly so a future refactor that closes
  // over state doesn't leave us with a stale closure (audit finding M10).
  // Zustand action refs are stable, so this pattern is one selector per
  // handler and does not cost extra re-renders.
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);

  const sleepActive = sleepAt != null || sleepAfterTrack;
  const sleepLabel = sleepAfterTrack
    ? 'end'
    : sleepAt
      ? `${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))}m`
      : '';
  const cancelSleep = () => {
    setSleepTimer(null);
    setSleepAfterTrack(false);
  };
  const navigate = useNavigate();
  const [accent, setAccent] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const castAvailable = useCastStore((s) => s.available);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 64 && Math.abs(dy) < 48) {
      if (dx < 0) next(true);
      else prev();
    } else if (dy < -48 && Math.abs(dx) < 48) {
      navigate('/now-playing'); // swipe up → full screen
    }
  };

  const artUrl = song ? bestImage(song.images, 150) : null;

  useEffect(() => {
    let alive = true;
    if (artUrl) {
      void extractAverageColor(artUrl).then((c) => alive && setAccent(c));
      // Living color: the artwork's vibrant tone drives the whole skin (--art).
      void extractVibrantColor(artUrl).then((c) => alive && applyArtColor(c));
    } else {
      setAccent(null);
      applyArtColor(null);
    }
    return () => {
      alive = false;
    };
  }, [artUrl]);

  // Song-change bloom: toggle .np-changed for ~400ms whenever the current
  // song's id flips. Drops out under reduce-motion via the CSS keyframe guard.
  const [changed, setChanged] = useState(false);
  const songId = song?.id;
  useEffect(() => {
    if (!songId) return;
    setChanged(true);
    const t = window.setTimeout(() => setChanged(false), 420);
    return () => window.clearTimeout(t);
  }, [songId]);

  if (!song) return null;

  return (
    <>
      {/* ---- Mobile: floating mini-player card (artwork-tinted) ---- */}
      <div className="sm:hidden px-2 pb-1.5">
        <div
          className={cn(
            'np-mini relative rounded-xl overflow-hidden shadow-lg border border-glass',
            changed && 'np-changed',
          )}
          data-buffering={isBuffering ? 'true' : undefined}
          style={{ background: accent ?? `rgb(var(--ink-800))` }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center gap-2.5 pl-2 pr-1 py-1.5 bg-ink-950/30 backdrop-blur-md">
            <button
              onClick={() => navigate('/now-playing')}
              className="flex items-center gap-3.5 flex-1 min-w-0 text-left"
              aria-label="Open full screen player"
            >
              <span className="np-mini-thumb relative w-10 h-10 shrink-0 rounded-md overflow-hidden">
                <img
                  src={artUrl ?? FALLBACK_ART}
                  onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                  alt=""
                  className={cn('w-10 h-10 rounded-md object-cover', isBuffering && 'opacity-50')}
                />
              </span>
              <span className="min-w-0 flex-1">
                <Marquee text={song.title} className="text-[13px] font-semibold text-ink-100" />
                <span className="block text-[11px] text-ink-200/70 truncate">{song.subtitle}</span>
              </span>
            </button>
            {sleepActive && (
              <button onClick={cancelSleep} aria-label="Cancel sleep timer" className="flex items-center gap-1 px-2 py-1 rounded-full bg-ink-700/60 text-[11px] font-bold text-ink-100 relative after:absolute after:inset-0 after:-m-[10px]">
                <ClockIcon className="w-3.5 h-3.5" /> {sleepLabel}
              </button>
            )}
            {castAvailable && (
              <div className="w-8 h-8 flex items-center justify-center mr-1">
                {/* @ts-expect-error custom element */}
                <cast-media-route-button style={{ width: '24px', height: '24px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'currentColor' }} />
              </div>
            )}
            <FavButton song={song} className="text-ink-200" />
            <button
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay}
              className="np-mini-play inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.12] text-ink-100 shrink-0 active:scale-95 transition-transform"
            >
              {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6 ml-0.5" />}
            </button>
          </div>
          {/* progress hairline inside the card */}
          <ProgressHairline />
        </div>
      </div>

      {/* ---- Desktop bar: three-zone layout ---- */}
      <div className="hidden sm:block mx-3 mb-3 rounded-3xl overflow-hidden glass-bottom-player">
        <div className="flex items-center gap-4 px-4 py-2.5 max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-3 min-w-0 w-60 lg:w-80">
            <button onClick={() => navigate('/now-playing')} aria-label="Open full screen player" className="group shrink-0">
              <img
                src={artUrl ?? FALLBACK_ART}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                className={cn('w-14 h-14 rounded-xl object-cover group-hover:opacity-80 transition-opacity ring-1 ring-white/10 shadow-md', isBuffering && 'opacity-50')}
              />
            </button>
            <div className="min-w-0">
              <Marquee text={song.title} className="text-sm font-semibold" />
              <p className="text-xs text-ink-300 truncate">{song.subtitle}</p>
            </div>
            <FavButton song={song} />
          </div>

          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-3">
              <IconButton label={`Shuffle ${shuffle ? 'on' : 'off'}`} onClick={toggleShuffle} active={shuffle} size="sm">
                <ShuffleIcon className="w-4 h-4" />
              </IconButton>
              <IconButton label="Previous" onClick={prev} size="sm" className="text-ink-100">
                <PrevIcon className="w-5 h-5" />
              </IconButton>
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="np-play-desktop w-11 h-11 rounded-full bg-premium text-white flex items-center justify-center hover:scale-[1.06] active:scale-95 transition-transform"
              >
                {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
              </button>
              <IconButton label="Next" onClick={() => next(true)} size="sm" className="text-ink-100">
                <NextIcon className="w-5 h-5" />
              </IconButton>
              <IconButton label={`Repeat: ${repeat}`} onClick={cycleRepeat} active={repeat !== 'off'} size="sm" className="relative">
                <RepeatIcon className="w-4 h-4" />
                {repeat === 'one' && (
                  <span className="absolute -top-0.5 right-0.5 text-[9px] font-bold text-ember-400">1</span>
                )}
              </IconButton>
            </div>
            <div className="w-full max-w-xl">
              <Seekbar />
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1 w-60 lg:w-80 justify-end">
            {castAvailable && (
              <div className="w-8 h-8 flex items-center justify-center mr-1">
                {/* Custom element defined by Google Cast SDK */}
                {/* @ts-expect-error custom element */}
                <cast-media-route-button style={{ width: '24px', height: '24px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'currentColor' }} />
              </div>
            )}
            {sleepActive && (
              <button onClick={cancelSleep} aria-label="Cancel sleep timer" title="Cancel sleep timer" className="flex items-center gap-1 px-2 py-1 mr-1 rounded-full border border-ink-600 text-[11px] font-bold text-ember-400 hover:border-ember-500 relative after:absolute after:inset-0 after:-m-[10px]">
                <ClockIcon className="w-3.5 h-3.5" /> {sleepLabel}
              </button>
            )}
            <Link to="/queue" aria-label="Queue" title="Queue" className="inline-flex items-center justify-center min-w-touch min-h-touch rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-700/70">
              <QueueIcon className="w-4 h-4" />
            </Link>
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="sm">
              <VolumeIcon className="w-4 h-4" muted={muted} />
            </IconButton>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-24"
              style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </>
  );
}
