import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
const DeviceSheet = lazy(() => import('./DeviceSheet').then(m => ({ default: m.DeviceSheet })));
// Lazy: the live lyric line pulls the synced-lyrics hook, which the first paint never needs.
const NowLine = lazy(() => import('./NowLine').then((m) => ({ default: m.NowLine })));
import {
  ClockIcon,
  DevicesIcon,
  ExpandIcon,
  MicIcon,
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
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  // scaleX, not width: a width animation re-lays-out and repaints inside the
  // backdrop-blurred card four times a second; a transform stays on the
  // compositor. The track clips the scaled fill, so its rounded ends survive.
  return (
    <div className="np-mini-progress" aria-hidden>
      <i style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

export function PlayerBar() {
  const [devicesOpen, setDevicesOpen] = useState(false);
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const sleepSongsLeft = usePlayerStore((s) => s.sleepSongsLeft);
  const setSleepSongs = usePlayerStore((s) => s.setSleepSongs);
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

  const sleepActive = sleepAt != null || sleepAfterTrack || sleepSongsLeft > 0;
  const sleepLabel = sleepAfterTrack
    ? 'end'
    : sleepSongsLeft > 0
      ? `${sleepSongsLeft} song${sleepSongsLeft === 1 ? '' : 's'}`
    : sleepAt
      ? `${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))}m`
      : '';
  const cancelSleep = () => {
    setSleepTimer(null);
    setSleepAfterTrack(false);
    setSleepSongs(0);
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
      <div className="lg:hidden px-2 pb-1.5" data-tour="player">
        <div
          className={cn(
            'np-mini relative rounded-xl overflow-hidden shadow-lg border border-glass',
            changed && 'np-changed',
          )}
          data-buffering={isBuffering ? 'true' : undefined}
          style={{ background: accent ? `color-mix(in srgb, ${accent} 16%, var(--vx-surface-raised))` : 'var(--vx-surface-raised)' }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center gap-2.5 pl-2 pr-1 py-1.5">
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
                <span className="block text-[11px] text-ink-400 truncate">{song.subtitle}</span>
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
            <FavButton song={song} className="text-ink-300" />
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay}
              className="np-mini-play relative after:absolute after:-inset-0.5 inline-flex items-center justify-center w-10 h-10 mx-1 bg-ink-100 text-ink-950 shrink-0 active:scale-95 transition-transform"
            >
              {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
            </button>
          </div>
          {/* progress hairline inside the card */}
          <ProgressHairline />
        </div>
      </div>

      {/* ---- Desktop: the player deck, three zones ---- */}
      {/* 9.0.0 — a floating, rounded deck tinted from the artwork's left edge. */}
      <div className="hidden lg:block vx-deck-wrap" data-tour="player">
        <div className="vx-deck">
        <div className="vx-pb-row">
          <div className="vx-pb-track">
            <button onClick={() => navigate('/now-playing')} aria-label="Open full screen player" className="vx-pb-art group shrink-0">
              <img
                src={artUrl ?? FALLBACK_ART}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                className={cn('w-14 h-14 object-cover', isBuffering && 'opacity-50')}
              />
              <span className="vx-pb-art-hint" aria-hidden><ExpandIcon className="w-4 h-4" /></span>
            </button>
            <div className="min-w-0">
              <Marquee text={song.title} className="vx-pb-title" />
              <p className="vx-pb-sub">{song.subtitle}</p>
            </div>
            <FavButton song={song} />
          </div>

          <div className="vx-pb-center">
            <div className="flex items-center gap-4">
              <IconButton label={`Shuffle ${shuffle ? 'on' : 'off'}`} onClick={toggleShuffle} active={shuffle} size="sm">
                <ShuffleIcon className="w-4 h-4" />
              </IconButton>
              <IconButton label="Previous" onClick={prev} size="sm" className="text-ink-100">
                <PrevIcon className="w-5 h-5" />
              </IconButton>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                // 42px squircle; its ::after pad keeps the hit area at 44px (shell.css).
                className="np-play-desktop"
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
              <Suspense fallback={null}><NowLine /></Suspense>
            </div>
          </div>

          <div className="vx-pb-tools">
            {castAvailable && (
              <div className="w-8 h-8 flex items-center justify-center mr-1">
                {/* Custom element defined by the cast SDK */}
                {/* @ts-expect-error custom element */}
                <cast-media-route-button style={{ width: '24px', height: '24px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'currentColor' }} />
              </div>
            )}
            {sleepActive && (
              <button onClick={cancelSleep} aria-label="Cancel sleep timer" title="Cancel sleep timer" className="flex items-center gap-1 px-2 py-1 mr-1 rounded-full border border-ink-600 text-[11px] font-bold text-ember-400 hover:border-ember-500 relative after:absolute after:inset-0 after:-m-[10px]">
                <ClockIcon className="w-3.5 h-3.5" /> {sleepLabel}
              </button>
            )}
            <Link to="/now-playing" aria-label="Lyrics and now playing" title="Lyrics and now playing" className="vx-pb-link"><MicIcon className="w-[18px] h-[18px]" /></Link>
            <Link to="/queue" aria-label="Queue" title="Queue" className="vx-pb-link">
              <QueueIcon className="w-[18px] h-[18px]" />
            </Link>
            <IconButton size="sm" label="Connect to a device" onClick={() => setDevicesOpen(true)}><DevicesIcon className="w-[18px] h-[18px]" /></IconButton>
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="sm">
              <VolumeIcon className="w-4 h-4" muted={muted} />
            </IconButton>
            <input
              type="range"
              aria-label="Volume"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="vx-volume"
              style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
            <Link to="/now-playing" aria-label="Full screen player" title="Full screen player" className="vx-pb-link"><ExpandIcon className="w-4 h-4" /></Link>
          </div>
        </div>
        </div>
      </div>
      {devicesOpen && <Suspense fallback={null}><DeviceSheet open onClose={() => setDevicesOpen(false)} /></Suspense>}
    </>
  );
}
