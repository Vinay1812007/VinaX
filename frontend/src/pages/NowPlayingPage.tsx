import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { filmTitleFromAlbumName } from '@/services/api/movies';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { TUNE_OPTIONS } from '@/services/recommendation/tune';
import { getMoodPin } from '@/services/personalization/session';
import { clearMoodPin, pinMood } from '@/features/player/moodPin';
import type { Mood } from '@/services/recommendation/mood';
import type { ArtistRef, Song } from '@/types';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { LiveLyricLine } from '@/components/LiveLyricLine';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { Seekbar } from '@/components/Seekbar';
import { FavButton } from '@/components/FavButton';
import { IconButton } from '@/components/IconButton';
import { TrackMenu } from '@/components/TrackMenu';
import { Marquee } from '@/components/Marquee';
import { EmptyState } from '@/components/States';
import {
  ChevronDownIcon,
  ClockIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShareIcon,
  ShuffleIcon,
  SparkleIcon,
  DevicesIcon,
  UsersIcon,
  VolumeIcon,
} from '@/components/Icons';
import { DeviceSheet } from '@/components/DeviceSheet';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SongCanvas, SongCanvasBackdrop, useSongCanvas } from '@/components/SongCanvas';
import { extractAverageColor } from '@/utils/color';
import { acquireWakeLock, releaseWakeLock } from '@/utils/wakeLock';
import { useSettingsStore } from '@/store/settingsStore';
import { useAudioOutputStore } from '@/services/audio/outputWatcher';
import { Visualizer } from '@/components/Visualizer';
import { useLibraryStore } from '@/store/libraryStore';
import { useCastStore } from '@/services/cast';
import { haptic } from '@/services/native';
import { shareLink } from '@/utils/share';
import { shareNowPlayingCard } from '@/utils/shareCard';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface CreditChip {
  icon: string;
  role: string;
  name: string;
  to: string;
}

/**
 * v5.5.4 — who-made-this credits under the title, every one clickable.
 * Roles come from the catalog when it provides them (music / singer /
 * lyricist); catalogs that send bare names still get clickable 🎤 Artist
 * chips, and the soundtrack album becomes the 🎬 Film chip.
 */
function buildCreditChips(song: Song, filmTitle: string | null): CreditChip[] {
  const chips: CreditChip[] = [];
  const seen = new Set<string>();
  const push = (icon: string, role: string, name: string, to: string): void => {
    const k = name.trim().toLowerCase();
    if (!k || seen.has(k) || chips.length >= 5) return;
    seen.add(k);
    chips.push({ icon, role, name, to });
  };
  const linkFor = (a: ArtistRef): string => (a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`);
  const roleOf = (a: ArtistRef): string => (a.role ?? '').toLowerCase();
  for (const a of song.artists) if (/music|compos/.test(roleOf(a))) push('🎼', 'Music', a.name, linkFor(a));
  for (const a of song.artists) if (/sing|vocal/.test(roleOf(a))) push('🎤', 'Singer', a.name, linkFor(a));
  for (const a of song.artists) if (/lyric/.test(roleOf(a))) push('✍️', 'Lyrics', a.name, linkFor(a));
  // Role-less catalog rows: still credit and link every name we have.
  for (const a of song.artists) if (!roleOf(a)) push('🎤', 'Artist', a.name, linkFor(a));
  // v5.6.0 — the film chip no longer needs an album id: when the catalog
  // sends only a name, the chip searches it, so the movie is ALWAYS tappable.
  if (song.album?.name) {
    chips.push({
      icon: '🎬',
      role: 'Film',
      name: filmTitle ?? song.album.name,
      to: song.album.id ? albumPath(song.album) : `/search/${encodeURIComponent(filmTitle ?? song.album.name)}`,
    });
  }
  return chips;
}

const SLEEP_OPTIONS = [15, 30, 60];

export default function NowPlayingPage() {
  const song = useCurrentSong();
  usePageTitle(song ? song.title : 'Now Playing');
  const navigate = useNavigate();
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const rate = usePlayerStore((s) => s.rate);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const streamKbps = usePlayerStore((s) => s.streamKbps);
  const {
    togglePlay, next, prev, cycleRepeat, toggleShuffle, setRate, setVolume, toggleMute,
    setSleepTimer, setSleepAfterTrack, playAt, startRadio, tuneQueue,
  } = usePlayerStore.getState();
  const reasons = useReasonStore((s) => s.reasons);
  const queueSource = usePlayerStore((s) => s.queueSource);

  const setCurrentAccent = usePlayerStore((s) => s.setCurrentAccent);
  const dynamicTheme = useSettingsStore((s) => s.dynamicTheme);
  const [showMore, setShowMore] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  // Resso-style flow: fling the artwork up for the next song, down for the previous.
  const artSwipe = useRef<{ y: number; t: number } | null>(null);
  const [swipeFx, setSwipeFx] = useState<'up' | 'down' | null>(null);
  const [rightTab, setRightTab] = useState<'queue' | 'lyrics'>('queue');
  // C5 — the manually pinned session mood (45-min override of inference).
  const [moodPin, setMoodPin] = useState<Mood | null>(() => getMoodPin());
  const [immersive, setImmersive] = useState(false);
  // Android back exits immersive lyrics before it leaves the player (P0-2).
  useDismissOnBack(immersive, () => setImmersive(false));
  const immersiveRef = useRef<HTMLDivElement>(null);
  useFocusTrap(immersiveRef, immersive, () => setImmersive(false));
  const tabTouched = useRef(false);
  const onArtTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation(); // keep the sheet's dismiss-drag out of the artwork zone
    artSwipe.current = { y: e.touches[0].clientY, t: Date.now() };
  };
  const onArtTouchEnd = (e: React.TouchEvent) => {
    const s = artSwipe.current;
    artSwipe.current = null;
    if (!s) return;
    const dy = e.changedTouches[0].clientY - s.y;
    const dt = Date.now() - s.t;
    if (Math.abs(dy) < 80 || dt > 550) return;
    if (dy < 0) {
      setSwipeFx('up');
      next(true);
    } else {
      setSwipeFx('down');
      prev();
    }
    haptic('light');
    window.setTimeout(() => setSwipeFx(null), 340);
  };

  const keepScreenOn = useSettingsStore((s) => s.keepScreenOn);
  const externalDevice = useAudioOutputStore((s) => s.externalLabel);
  const castAvailable = useCastStore((s) => s.available);
  const castDeviceName = useCastStore((s) => s.deviceName);
  const lyrics = useSyncedLyrics(song);
  useEffect(() => {
    if (!tabTouched.current && lyrics.data?.synced) setRightTab('lyrics');
  }, [lyrics.data]);

  // Keep the screen awake while this view is open and music plays.
  useEffect(() => {
    if (keepScreenOn && isPlaying) void acquireWakeLock();
    else releaseWakeLock();
    return releaseWakeLock;
  }, [keepScreenOn, isPlaying]);

  // Esc closes the full-screen player — unless focus is inside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // slide-up entrance: start off-screen before paint, then spring up.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = 'translateY(100%)';
    el.style.willChange = 'transform';
    const id = requestAnimationFrame(() => {
      el.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0)';
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const artUrl = song ? bestImage(song.images, 500) : null;
  // v5.7.11 — one canvas state for both surfaces (mobile backdrop / PC square).
  const canvas = useSongCanvas(song);

  useEffect(() => {
    let alive = true;
    if (!dynamicTheme) {
      setCurrentAccent(null);
      return;
    }
    if (artUrl) {
      void extractAverageColor(artUrl).then((c) => {
        if (alive) setCurrentAccent(c);
      });
    }
    return () => {
      alive = false;
    };
  }, [artUrl, dynamicTheme, setCurrentAccent]);

  if (!song) {
    return (
      <EmptyState
        title="Nothing playing"
        message="Pick a song and it will take the stage here."
        action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
      />
    );
  }

  const upNext = queue.slice(index + 1, index + 6);
  const playingFrom = song.album?.name ?? 'Your Queue';
  const filmTitle = song.album ? filmTitleFromAlbumName(song.album.name) : null;
  const creditChips = buildCreditChips(song, filmTitle);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen unavailable'));
  };

  const doubleSeek = (dir: 1 | -1) => {
    const p = usePlayerStore.getState();
    p.seek(Math.max(0, Math.min(p.currentTime + dir * 10, p.duration)));
    toast(dir > 0 ? '+10s' : '−10s');
  };


  // sheet: drag down to dismiss with the finger, animated slide-down on close.
  const closeSheet = () => {
    const el = sheetRef.current;
    if (!el) {
      navigate(-1);
      return;
    }
    let fired = false;
    const go = () => {
      if (fired) return;
      fired = true;
      navigate(-1);
    };
    el.style.transition = 'transform 300ms cubic-bezier(0.4, 0, 1, 1)';
    el.style.transform = 'translateY(100%)';
    el.addEventListener('transitionend', go, { once: true });
    window.setTimeout(go, 380);
  };
  const onSheetTouchStart = (e: React.TouchEvent) => {
    // Only the upper area starts a dismiss-drag, so the lists/lyrics scroll freely.
    const y = e.touches[0].clientY;
    drag.current = y < window.innerHeight * 0.45 ? { y, dy: 0 } : null;
    if (drag.current && sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const onSheetTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = e.touches[0].clientY - d.y;
    d.dy = dy;
    if (dy > 0) el.style.transform = `translateY(${dy}px)`;
  };
  const onSheetTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    if (!d || !el) return;
    if (d.dy > 110) {
      closeSheet();
    } else {
      el.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0)';
    }
  };

  return (
    <div ref={sheetRef} className="relative -mx-4 md:-mx-8 -mt-4 px-5 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] min-h-[100dvh] -mb-44 md:-mb-28 overflow-hidden" onTouchStart={onSheetTouchStart} onTouchMove={onSheetTouchMove} onTouchEnd={onSheetTouchEnd}>
      {/* Backdrop: the album art, heavily blurred + scaled, under a theme-adaptive
          darkening gradient (Apple-Music full-player look). Reuses the loaded art. */}
      <div className="absolute inset-0 -z-10" aria-hidden>
        {artUrl && (
          <img
            src={artUrl}
            alt=""
            aria-hidden
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-3xl"
          />
        )}
        {/* v5.7.12 — the video canvas: the clip fills the whole player behind
            the gradients on every screen size (Spotify-canvas style). */}
        <SongCanvasBackdrop canvas={canvas} isPlaying={isPlaying} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgb(var(--ember-500) / 0.16), transparent 45%)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950" />
      </div>

      <div className="max-w-md lg:max-w-5xl mx-auto flex flex-col min-h-full">
        {/* Top bar — width-locked to the artwork column on lg so it never collides with the right panel */}
        <div className="flex items-center justify-between lg:max-w-[26rem]">
          <IconButton label="Close" onClick={closeSheet}>
            <ChevronDownIcon className="w-6 h-6" />
          </IconButton>
          <button onClick={toggleFullscreen} className="flex flex-col items-center min-w-0 px-2" title="Toggle fullscreen">
            <span className="flex items-center gap-2">
              <Visualizer />
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-200/80 font-semibold">Playing from</span>
            </span>
            <span className="block text-xs font-bold truncate max-w-[180px]">{playingFrom}</span>
          </button>
          <TrackMenu song={song} />
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12 lg:items-start">
        <div className="flex flex-col min-w-0">

        {/* Artwork */}
        <div
          className={cn(
            'relative mt-5 mb-6 select-none mx-auto touch-pan-x',
            swipeFx === 'up' && 'motion-safe:animate-[np-swipe-next_320ms_ease-out]',
            swipeFx === 'down' && 'motion-safe:animate-[np-swipe-prev_320ms_ease-out]',
          )}
          data-deter-context
          onTouchStart={onArtTouchStart}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={onArtTouchEnd}
        >
          <div
            aria-hidden
            className={cn(
              'absolute -inset-6 rounded-[2.5rem] blur-2xl transition-opacity duration-700 bg-[radial-gradient(60%_60%_at_50%_45%,rgb(var(--ember-500)/0.32),rgb(var(--aura-violet)/0.16)_58%,transparent_82%)] motion-safe:animate-[aura-pulse_5.5s_ease-in-out_infinite]',
              // The aura steps aside with the artwork while the canvas plays,
              // so the full-screen video shows through untinted.
              canvas.src ? 'opacity-0' : isPlaying ? 'opacity-100' : 'opacity-40',
            )}
          />
          {/* v5.7.12 — while the canvas plays full-screen, this slot becomes a
              transparent window (same size, so the layout holds) and hosts the
              ART/VIDEO toggle; still artwork returns the moment it's off. */}
          <SongCanvas canvas={canvas} isPlaying={isPlaying} artUrl={artUrl} />
          <button aria-label="Rewind 10 seconds (double tap)" onDoubleClick={() => doubleSeek(-1)} className="absolute inset-y-0 left-0 w-1/3 rounded-l-3xl" />
          <button
            aria-label="Double tap to favorite"
            onDoubleClick={() => {
              useLibraryStore.getState().toggleFavorite(song);
              haptic('medium');
            }}
            className="absolute inset-y-0 left-1/3 w-1/3"
          />
          <button aria-label="Forward 10 seconds (double tap)" onDoubleClick={() => doubleSeek(1)} className="absolute inset-y-0 right-0 w-1/3 rounded-r-3xl" />
        </div>

        {/* Title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Marquee text={song.title} className="text-[22px] font-bold" />
            <p className="text-sm text-ink-300 truncate mt-0.5">
              {song.artists[0]?.id ? (
                <Link to={artistPath(song.artists[0])} className="hover:underline">{song.subtitle}</Link>
              ) : (
                song.subtitle
              )}
            </p>
            {streamKbps != null && (
              <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-ink-800 text-ink-300">
                {streamKbps >= 320 ? 'HD · ' : ''}{streamKbps} kbps
              </span>
            )}
            {creditChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {creditChips.map((c) => (
                  <Link
                    key={`${c.role}-${c.name}`}
                    to={c.to}
                    className="flex max-w-full items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-ink-800/70 border border-glass text-ink-200 hover:text-ink-100 hover:bg-ink-700 transition-colors"
                  >
                    <span aria-hidden="true">{c.icon}</span>
                    <span className="text-ink-400">{c.role}</span>
                    <span className="truncate">{c.name}</span>
                  </Link>
                ))}
              </div>
            )}
            {reasons[song.id] && (
              <p className="mt-2 flex items-center gap-1.5 text-xs italic text-ember-300/90">
                <SparkleIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{reasons[song.id]}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {castAvailable && (
              <div className="w-10 h-10 flex items-center justify-center -mr-2">
                {/* @ts-expect-error custom element */}
                <cast-media-route-button style={{ width: '24px', height: '24px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'rgb(var(--ink-400))' }} />
              </div>
            )}
            <button onClick={() => setShowDevices(true)} aria-label="Connect to a device" className="w-10 h-10 flex items-center justify-center rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-800">
              <DevicesIcon className="w-5 h-5" />
            </button>
            <FavButton song={song} />
          </div>
        </div>

        {(externalDevice || castDeviceName) && (
          <p className="text-[11px] font-semibold text-tide-400 mt-2 flex items-center gap-1.5">
            🎧 Playing on {castDeviceName || externalDevice}
          </p>
        )}

        {/* live lyric strip — tap to open the full lyrics page */}
        {lyrics.data?.synced ? (
          <div className={cn(rightTab === 'lyrics' && 'lg:hidden')}>
            <LiveLyricLine lines={lyrics.data.synced} onOpen={() => setImmersive(true)} />
          </div>
        ) : lyrics.data?.plain ? (
          <button
            onClick={() => setImmersive(true)}
            aria-label="Open lyrics"
            className="w-full text-left mt-3 px-4 py-3.5 rounded-2xl bg-ink-950/30 hover:bg-ink-950/45 transition-colors flex items-center justify-between gap-3"
          >
            <span className="text-sm font-bold text-ink-100">Lyrics available</span>
            <span className="text-xs font-semibold text-ember-300">Open lyrics ›</span>
          </button>
        ) : null}

        {/* Seek */}
        <div className="mt-3">
          <Seekbar timesBelow />
        </div>

        {/* Main transport */}
        <div className="flex items-center justify-between mt-1.5">
          <IconButton label={`Shuffle ${shuffle ? 'on' : 'off'}`} onClick={toggleShuffle} active={shuffle}>
            <ShuffleIcon className="w-5 h-5" />
          </IconButton>
          <IconButton label="Previous" onClick={prev} size="lg" className="text-ink-100">
            <PrevIcon className="w-8 h-8" />
          </IconButton>
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-16 h-16 rounded-full bg-premium text-white flex items-center justify-center shadow-[0_12px_36px_-10px_rgb(var(--ember-500)/0.6)] hover:scale-105 active:scale-95 transition-transform"
          >
            {isBuffering ? (
              <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <PauseIcon className="w-7 h-7" />
            ) : (
              <PlayIcon className="w-7 h-7 ml-1" />
            )}
          </button>
          <IconButton label="Next" onClick={() => next(true)} size="lg" className="text-ink-100">
            <NextIcon className="w-8 h-8" />
          </IconButton>
          <IconButton label={`Repeat: ${repeat}`} onClick={cycleRepeat} active={repeat !== 'off'} className="relative">
            <RepeatIcon className="w-5 h-5" />
            {repeat === 'one' && <span className="absolute top-1 right-1.5 text-[9px] font-bold text-ember-400">1</span>}
          </IconButton>
        </div>

        {/* Secondary action row */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => startRadio(song)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs btn-secondary"
          >
            <SparkleIcon className="w-4 h-4" /> Radio
          </button>
          <button
            onClick={() => navigate('/drive')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs btn-secondary"
          >
            Drive mode
          </button>
          <div className="flex items-center gap-1">
            <IconButton
              label="Share link"
              size="sm"
              onClick={() => void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied'))}
            >
              <ShareIcon className="w-4 h-4" />
            </IconButton>
            <IconButton
              label="Share as image"
              size="sm"
              onClick={() =>
                void shareNowPlayingCard(song).then((r) => {
                  if (r === 'downloaded') toast('Card saved');
                  else if (r === 'failed') toast('Couldn’t create card');
                })
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </IconButton>
            <IconButton label="More options" size="sm" onClick={() => setShowMore((v) => !v)} active={showMore}>
              <ClockIcon className="w-4 h-4" />
            </IconButton>
            <Link to="/together" aria-label="Listen together" className="inline-flex items-center justify-center min-w-touch min-h-touch rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-700/70">
              <UsersIcon className="w-4 h-4" />
            </Link>
            <Link to="/queue" aria-label="Queue" className="inline-flex items-center justify-center min-w-touch min-h-touch rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-700/70">
              <QueueIcon className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Collapsible extras: volume / speed / sleep */}
        {showMore && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5 mt-4 p-3 rounded-2xl glass-panel animate-fade-up">
            <div className="flex items-center gap-1.5">
              <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="sm">
                <VolumeIcon className="w-4 h-4" muted={muted} />
              </IconButton>
              <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-24" style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-ink-400 uppercase">Speed</span>
              <input
                type="range"
                aria-label="Playback speed"
                min={0.5}
                max={2.5}
                step={0.05}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-24"
                style={{ '--fill': `${((rate - 0.5) / 2) * 100}%` } as React.CSSProperties}
              />
              <span className="text-[10px] font-bold text-ember-400 w-6 tabular-nums">{rate.toFixed(2)}x</span>
            </div>
            <div className="flex items-center gap-0.5" role="group" aria-label="Sleep timer">
              <ClockIcon className="w-4 h-4 text-ink-400" />
              {SLEEP_OPTIONS.map((m) => (
                <button key={m} onClick={() => setSleepTimer(m)} className="px-2.5 py-2 rounded-lg text-xs font-semibold text-ink-400 hover:text-ink-100">{m}m</button>
              ))}
              <button
                onClick={() => setSleepAfterTrack(!sleepAfterTrack)}
                className={cn('px-2.5 py-2 rounded-lg text-xs font-semibold', sleepAfterTrack ? 'text-ember-400' : 'text-ink-400 hover:text-ink-100')}
              >
                end of song
              </button>
              {sleepAt && (
                <button onClick={() => setSleepTimer(null)} className="px-2.5 py-2 rounded-lg text-xs font-semibold text-ember-400">
                  cancel ({Math.max(0, Math.round((sleepAt - Date.now()) / 60_000))}m)
                </button>
              )}
            </div>
          </div>
        )}


        </div>

        <div className="flex flex-col min-w-0">
        <div className="mt-6 lg:mt-0 flex items-center gap-2" role="tablist" aria-label="Player panels">
          <button
            role="tab"
            aria-selected={rightTab === 'queue'}
            onClick={() => {
              tabTouched.current = true;
              setRightTab('queue');
            }}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-bold transition-colors',
              rightTab === 'queue' ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200',
            )}
          >
            Up Next{upNext.length > 0 ? ` · ${upNext.length}` : ''}
          </button>
          <button
            role="tab"
            aria-selected={rightTab === 'lyrics'}
            onClick={() => {
              tabTouched.current = true;
              setRightTab('lyrics');
            }}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-bold transition-colors',
              rightTab === 'lyrics' ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200',
            )}
          >
            Lyrics
          </button>
        </div>
        {rightTab === 'queue' && (
        <>
        {/* Tune this queue */}
        <div className="mt-6 lg:mt-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-2">Tune this queue</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {TUNE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  tuneQueue(opt.id);
                  toast(`Tuning: ${opt.label}…`);
                }}
                aria-label={`Tune queue: ${opt.label}`}
                className="shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100 active:scale-95"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* C5 — pin a mood: overrides the inferred session mood for 45 min */}
        <div className="mt-5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-2">
            Pin a mood <span className="normal-case font-semibold text-ink-500 tracking-normal">· steers picks for 45 min</span>
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {(
              [
                ['romantic', 'Romantic'],
                ['energetic', 'Energetic'],
                ['chill', 'Chill'],
                ['melancholy', 'Melancholy'],
                ['devotional', 'Devotional'],
              ] as Array<[Mood, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => {
                  if (moodPin === m) {
                    clearMoodPin();
                    setMoodPin(null);
                    toast('Mood unpinned');
                  } else {
                    pinMood(m);
                    setMoodPin(m);
                    toast(`${label} pinned — picks lean that way for 45 min`);
                  }
                }}
                aria-pressed={moodPin === m}
                className={
                  moodPin === m
                    ? 'shrink-0 px-3.5 py-2 rounded-full text-xs font-bold bg-ember-500/25 text-ember-200 border border-ember-400/40 transition active:scale-95'
                    : 'shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100 active:scale-95'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Up next */}
        <div className="mt-6 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400">Up Next</h2>
              {upNext.length > 0 && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-ink-800/70 border border-glass',
                    queueSource === 'ai' ? 'text-ember-300' : 'text-ink-300',
                  )}
                  title={queueSource === 'ai' ? 'This continuation was curated by the AI DJ' : 'The AI was busy — these are instant local picks tuned to your taste'}
                >
                  <SparkleIcon className="w-3 h-3" /> {queueSource === 'ai' ? 'AI DJ' : 'Instant picks'}
                </span>
              )}
            </span>
            <Link to="/queue" className="text-xs font-semibold text-ember-400">Full queue</Link>
          </div>
          {upNext.length === 0 && (
            <p className="text-sm text-ink-400 flex items-center gap-1.5">
              <SparkleIcon className="w-4 h-4 text-ember-400 shrink-0" />
              The AI DJ lines up what plays next — picks land here in a moment.
            </p>
          )}
          {upNext.map((s, i) => (
            <button key={`${s.id}-${i}`} onClick={() => playAt(index + 1 + i)} className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-ink-800/60 text-left">
              <img src={bestImage(s.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-9 h-9 rounded-lg object-cover" />
              <span className="min-w-0">
                <span className="block text-sm truncate">{s.title}</span>
                <span className="block text-xs text-ink-400 truncate">{s.subtitle}</span>
                {reasons[s.id] && (
                  <span className="block text-[11px] text-ember-400/80 truncate italic">✨ {reasons[s.id]}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        </>
        )}
        {rightTab === 'lyrics' && (
          <div className="mt-5">
            {lyrics.data?.synced ? (
              <SyncedLyrics lines={lyrics.data.synced} live className="max-h-[30rem] overflow-y-auto pr-1" />
            ) : lyrics.data?.plain ? (
              <div className="max-h-[30rem] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-ink-200 pr-2">
                {lyrics.data.plain}
              </div>
            ) : (
              <p className="text-sm text-ink-400">No lyrics for this song yet.</p>
            )}
          </div>
        )}
        </div>
        </div>
      </div>
      {immersive && (
        <div
          ref={immersiveRef}
          role="dialog"
          aria-modal="true"
          aria-label="Immersive lyrics"
          className="absolute inset-0 z-30 flex flex-col animate-fade-up bg-ink-950/25 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <IconButton label="Close lyrics" onClick={() => setImmersive(false)}>
              <ChevronDownIcon className="w-6 h-6" />
            </IconButton>
            <span className="min-w-0 px-2 text-xs font-bold uppercase tracking-widest text-ink-300 truncate">
              {song.title}
            </span>
            <span className="w-11" aria-hidden />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 w-full max-w-xl mx-auto overscroll-contain">
            {lyrics.data?.synced ? (
              <SyncedLyrics lines={lyrics.data.synced} live size="lg" />
            ) : lyrics.data?.plain ? (
              <div className="whitespace-pre-wrap text-xl leading-9 text-ink-100 font-semibold">{lyrics.data.plain}</div>
            ) : (
              <p className="text-sm text-ink-400 text-center mt-16">No lyrics for this song yet.</p>
            )}
          </div>
          <div className="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full max-w-xl mx-auto">
            <Seekbar timesBelow />
            <div className="flex items-center justify-center gap-10 mt-1">
              <IconButton label="Previous" onClick={prev} size="lg" className="text-ink-100">
                <PrevIcon className="w-7 h-7" />
              </IconButton>
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="w-14 h-14 rounded-full bg-premium text-white flex items-center justify-center shadow-[0_12px_36px_-10px_rgb(var(--ember-500)/0.6)] hover:scale-105 active:scale-95 transition-transform"
              >
                {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6 ml-0.5" />}
              </button>
              <IconButton label="Next" onClick={() => next(true)} size="lg" className="text-ink-100">
                <NextIcon className="w-7 h-7" />
              </IconButton>
            </div>
          </div>
        </div>
      )}
      <DeviceSheet open={showDevices} onClose={() => setShowDevices(false)} />
    </div>
  );
}
