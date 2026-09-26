import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { filmTitleFromAlbumName } from '@/services/api/movies';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { getMoodPin } from '@/services/personalization/session';
import { clearMoodPin, pinMood } from '@/features/player/moodPin';
import type { Mood } from '@/services/recommendation/mood';
import type { ArtistRef, Song } from '@/types';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { Seekbar } from '@/components/Seekbar';
import { FavButton } from '@/components/FavButton';
import { IconButton } from '@/components/IconButton';
import { TrackMenu, type TrackMenuItem } from '@/components/TrackMenu';
import { Marquee } from '@/components/Marquee';
import { EmptyState } from '@/components/States';
import {
  ChevronDownIcon,
  MicIcon,
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
  VolumeIcon,
} from '@/components/Icons';
import { DeviceSheet } from '@/components/DeviceSheet';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SongCanvas, SongCanvasBackdrop, useSongCanvas } from '@/components/SongCanvas';
import { extractAverageColor, extractVibrantColor } from '@/utils/color';
import { acquireWakeLock, releaseWakeLock } from '@/utils/wakeLock';
import { useSettingsStore } from '@/store/settingsStore';
import { useAudioOutputStore } from '@/services/audio/outputWatcher';
import { useLibraryStore } from '@/store/libraryStore';
import { useCastStore } from '@/services/cast';
import { haptic } from '@/services/native';
import { shareLink } from '@/utils/share';
import { useBookmarkStore } from '@/store/bookmarkStore';
import { AmbientOverlay, useIdle } from '@/components/AmbientOverlay';
import { shareNowPlayingCard } from '@/utils/shareCard';
import { toast } from '@/store/toastStore';
import { TuneChips } from '@/features/queue/TuneChips';
import { Chip } from '@/components/Chip';
import { songLine } from '@/utils/songLine';
import type { TuneIntent } from '@/services/recommendation/tune';
import { cn } from '@/utils/cn';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Sheet } from '@/components/Sheet';
import { scrollBehavior } from '@/utils/motion';
import '@/styles/pages/player.css';

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
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * The hairline of progress that survives into immersive mode. It subscribes
 * to the clock itself so ticking time never re-renders the whole player.
 */
function CanvasProgress() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  // scaleX instead of width: compositor-only, no layout 4×/s over the blurred canvas.
  return (
    <div className="mt-3 h-[3px] rounded-full bg-white/25 overflow-hidden">
      <div
        className="h-full w-full origin-left bg-white/85 transition-transform duration-300"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

/**
 * "＋ 1:23" bookmark button. Its label shows the clock, so it is the ONE place
 * in the extras panel that follows playback time — as a leaf, on whole
 * seconds, instead of a page-level subscription that re-rendered the entire
 * player four times a second. The exact position is read at click time.
 */
function BookmarkNowButton({ songId }: { songId: string }) {
  const second = usePlayerStore((s) => Math.floor(s.currentTime));
  return (
    <button
      onClick={() => {
        const at = usePlayerStore.getState().currentTime;
        useBookmarkStore.getState().add(songId, at);
        toast(`Bookmarked ${fmtTime(at)}`);
      }}
      className="vx-np-pill"
      title="Bookmark this moment"
    >
      ＋ {fmtTime(second)}
    </button>
  );
}

/** "Sliders" glyph for the playback options (speed, sleep, loops, marks). */
function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/** The stage backdrop: blurred artwork under the artwork's own colour. */
function StageBackdrop({ artUrl, children }: { artUrl: string | null; children?: React.ReactNode }) {
  return (
    <div className="vx-np-bg" aria-hidden>
      {artUrl && <img src={artUrl} alt="" loading="eager" decoding="async" className="vx-np-bg-art" />}
      {children}
    </div>
  );
}

/** Mood → the tune intent that rebuilds the queue for it. */
const MOOD_PINS: Array<[Mood, string, TuneIntent]> = [
  ['romantic', 'Romantic', 'romantic'],
  ['energetic', 'Energetic', 'energetic'],
  ['chill', 'Chill', 'chill'],
  ['melancholy', 'Melancholy', 'heartbreak'],
  ['devotional', 'Devotional', 'devotional'],
];

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
  const sleepSongsLeft = usePlayerStore((s) => s.sleepSongsLeft);
  const loopA = usePlayerStore((s) => s.loopA);
  const loopB = usePlayerStore((s) => s.loopB);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const streamKbps = usePlayerStore((s) => s.streamKbps);
  const {
    togglePlay, next, prev, cycleRepeat, toggleShuffle, setRate, setVolume, toggleMute,
    setSleepTimer, setSleepAfterTrack, playAt, setSleepSongs, setLoopPoint, clearLoop,
  } = usePlayerStore.getState();
  const reasons = useReasonStore((s) => s.reasons);

  const setCurrentAccent = usePlayerStore((s) => s.setCurrentAccent);
  const dynamicTheme = useSettingsStore((s) => s.dynamicTheme);
  const [showMore, setShowMore] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  // v5.17.0 — song bookmarks, ambient mode, data saver.
  const seek = usePlayerStore((s) => s.seek);
  const marks = useBookmarkStore((b) => (song ? b.marks[song.id] : undefined)) ?? [];
  const removeMark = useBookmarkStore((b) => b.remove);
  const dataSaver = useSettingsStore((s) => s.dataSaver);
  const [ambientArmed, setAmbientArmed] = useState(true);
  const [ambientIdle, wakeAmbient] = useIdle(ambientArmed && isPlaying && !showMore && !showDevices);

  // Swipe flow: fling the artwork up for the next song, down for the previous.
  const artSwipe = useRef<{ y: number; t: number } | null>(null);
  const [swipeFx, setSwipeFx] = useState<'up' | 'down' | null>(null);
  const [rightTab, setRightTab] = useState<'queue' | 'lyrics' | 'about'>('queue');
  const panelRef = useRef<HTMLElement>(null);
  // The artwork's own colour for the stage wash (an "R G B" triplet).
  const [wash, setWash] = useState<string | null>(null);
  // C5 — the manually pinned session mood (45-min override of inference).
  const [moodPin, setMoodPin] = useState<Mood | null>(() => getMoodPin());
  // True from a mood tap until the rebuilt list arrives (or the attempt gives up).
  const [rebuilding, setRebuilding] = useState(false);
  const upcomingCount = usePlayerStore((st) => Math.max(0, st.queue.length - st.index - 1));
  // The rebuilt list arrived — or, after a generous wait, it is not coming (offline, empty catalogue).
  useEffect(() => {
    if (!rebuilding) return;
    if (upcomingCount > 0) { setRebuilding(false); return; }
    const t = window.setTimeout(() => setRebuilding(false), 35_000);
    return () => window.clearTimeout(t);
  }, [rebuilding, upcomingCount]);
  const [immersive, setImmersive] = useState(false);
  // Android back exits immersive lyrics before it leaves the player (P0-2).
  useDismissOnBack(immersive, () => setImmersive(false));
  const immersiveRef = useRef<HTMLDivElement>(null);
  useFocusTrap(immersiveRef, immersive, () => setImmersive(false));
  // v5.8.2 — immersive canvas: tap the clip and every control drops
  // away, tap again and they come back. Only offered while a video canvas is
  // actually playing — hiding the chrome over still artwork leaves a dead
  // screen, not an immersive one.
  const [chromeHidden, setChromeHidden] = useState(false);
  // Android back gives the controls back before it leaves the player (P0-2).
  useDismissOnBack(chromeHidden, () => setChromeHidden(false));
  const hintShown = useRef(false);
  // A single tap toggles the chrome, but the double-tap seek/favourite zones
  // live in the same layer — so the toggle waits out the double-tap window
  // and the second click cancels it. Without this, a double-tap seek would
  // flash the whole UI off and back on.
  const tapTimer = useRef<number | null>(null);
  const cancelTap = () => {
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  };
  useEffect(() => cancelTap, []);
  const onCanvasTap = () => {
    cancelTap();
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (!chromeHidden && !hintShown.current) {
        hintShown.current = true;
        toast('Tap anywhere to bring the controls back');
      }
      setChromeHidden(!chromeHidden);
      haptic('light');
    }, 260);
  };
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
      if (chromeHidden) {
        setChromeHidden(false);
        return;
      }
      navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, chromeHidden]);

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
  // v5.17.0 — data saver skips the video canvas entirely.
  const canvas = useSongCanvas(dataSaver ? null : song);
  const canvasOn = !!canvas.src;
  // The clip went away (no video for this song, canvas toggled off, playback
  // failed) — hand the controls straight back rather than leaving a blank.
  useEffect(() => {
    if (!canvasOn) setChromeHidden(false);
  }, [canvasOn]);

  useEffect(() => {
    let alive = true;
    if (!artUrl) {
      setWash(null);
      return;
    }
    void extractVibrantColor(artUrl).then((c) => {
      if (alive) setWash(c);
    });
    return () => {
      alive = false;
    };
  }, [artUrl]);

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

  // The three gesture thirds over the clip / artwork: double-tap seek on the
  // edges, double-tap favourite in the middle, single tap toggles the
  // controls when a clip is on. Shared by the in-sheet pane and the
  // immersive layer.
  const tapZones = (
    <>
      <button
        aria-label={canvasOn ? 'Rewind 10 seconds (double tap), or tap to toggle the controls' : 'Rewind 10 seconds (double tap)'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          doubleSeek(-1);
        }}
        className="absolute inset-y-0 left-0 w-1/3 rounded-l-xl"
      />
      <button
        aria-label={canvasOn ? 'Double tap to favorite, or tap to toggle the controls' : 'Double tap to favorite'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          useLibraryStore.getState().toggleFavorite(song);
          haptic('medium');
        }}
        className="absolute inset-y-0 left-1/3 w-1/3"
      />
      <button
        aria-label={canvasOn ? 'Forward 10 seconds (double tap), or tap to toggle the controls' : 'Forward 10 seconds (double tap)'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          doubleSeek(1);
        }}
        className="absolute inset-y-0 right-0 w-1/3 rounded-r-xl"
      />
    </>
  );

  const upNext = queue.slice(index + 1, index + 6);
  const playingFrom = song.album?.name ?? 'Your queue';
  const filmTitle = song.album ? filmTitleFromAlbumName(song.album.name) : null;
  const creditChips = buildCreditChips(song, filmTitle);
  const washStyle = (wash ? { '--np-wash': wash } : undefined) as React.CSSProperties | undefined;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen unavailable'));
  };

  const doubleSeek = (dir: 1 | -1) => {
    const p = usePlayerStore.getState();
    p.seek(Math.max(0, Math.min(p.currentTime + dir * 10, p.duration)));
    toast(dir > 0 ? '+10s' : '−10s');
  };

  // The ⋯ menu carries the player's secondary destinations above the song actions.
  const menuItems: TrackMenuItem[] = [
    { label: 'Drive mode', action: () => navigate('/drive') },
    ...(lyrics.data?.synced ? [{ label: 'Karaoke', action: () => navigate('/karaoke') }] : []),
    { label: 'Listen together', action: () => navigate('/together') },
    {
      label: 'Share now-playing card',
      action: () =>
        void shareNowPlayingCard(song).then((r) => {
          if (r === 'downloaded') toast('Card saved');
          else if (r === 'failed') toast('Couldn’t create card');
        }),
    },
  ];

  const pickTab = (tab: 'queue' | 'lyrics' | 'about') => {
    tabTouched.current = true;
    setRightTab(tab);
    // Phone: the panel sits under the player — bring it up into view.
    if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
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
    const scrolled = (document.getElementById('main-content')?.scrollTop ?? 0) > 4;
    drag.current = !scrolled && y < window.innerHeight * 0.45 ? { y, dy: 0 } : null;
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

  const fadeWhenHidden = chromeHidden && 'opacity-0 pointer-events-none';

  const lyricsBody = (immersiveLayer: boolean) =>
    lyrics.data?.synced ? (
      <SyncedLyrics lines={lyrics.data.synced} live size="stage" className={immersiveLayer ? 'py-[18vh]' : 'pb-[30vh]'} />
    ) : lyrics.data?.plain ? (
      <div className={cn('vx-np-lyrics-plain', immersiveLayer ? 'py-10' : 'pb-10')}>{lyrics.data.plain}</div>
    ) : (
      <p className={cn('text-[15px] text-ink-300', immersiveLayer && 'text-center mt-16')}>No lyrics for this song yet.</p>
    );

  return (
    <div
      ref={sheetRef}
      className="vx-now-playing vx-np relative -mx-4 md:-mx-8 px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] min-h-[100dvh] -mb-44 md:-mb-28 overflow-hidden"
      style={washStyle}
      onTouchStart={onSheetTouchStart}
      onTouchMove={onSheetTouchMove}
      onTouchEnd={onSheetTouchEnd}
    >
      {/* Backdrop: the artwork blurred under its own colour, darkened (or, in
          the light theme, lightened) so every line of text keeps its contrast. */}
      <StageBackdrop artUrl={artUrl}>
        {/* v5.7.12 — the video canvas: the clip fills the whole player behind
            the gradients on every screen size (full-screen canvas style). */}
        {!chromeHidden && <SongCanvasBackdrop canvas={canvas} isPlaying={isPlaying} />}
        <div className="vx-np-bg-wash" style={{ opacity: canvasOn ? 0.35 : 1 }} />
        {/* v5.8.2 — the scrim thins over a playing clip so the video reads
            instead of drowning, and thins again once the controls are gone.
            It stays bottom-weighted either way, so whatever chrome is still
            on screen keeps its contrast. */}
        {canvasOn ? (
          <div
            className={cn(
              'absolute inset-0 bg-gradient-to-b',
              chromeHidden
                ? 'from-transparent via-transparent to-ink-950/60'
                : 'from-ink-950/35 via-ink-950/25 lg:via-ink-950/45 to-ink-950/95',
            )}
          />
        ) : (
          <div className="vx-np-bg-scrim" />
        )}
      </StageBackdrop>

      <div className="vx-np-inner">
        {/* Top bar: close, where this is playing from, the song menu */}
        <header className={cn('vx-np-top', fadeWhenHidden)} aria-hidden={chromeHidden}>
          <IconButton label="Close" onClick={closeSheet} className="text-ink-100">
            <ChevronDownIcon className="w-6 h-6" />
          </IconButton>
          <button onClick={toggleFullscreen} className="vx-np-context" title="Toggle fullscreen">
            <span className="vx-np-context-label">Playing from</span>
            <span className="vx-np-context-name">{playingFrom}</span>
          </button>
          <span className="vx-np-menu">
            <TrackMenu song={song} leadItems={menuItems} />
          </span>
        </header>

        <div className="vx-np-grid">
          <div className="vx-np-main">
            {/* Artwork card normally; with a clip on (v5.9.0, full-screen canvas), a
                transparent edge-to-edge pane over the full-screen clip that owns
                every gesture. Immersive mode is a separate viewport-fixed layer
                (see the portal below), so nothing here re-flows when the
                controls come and go. */}
            <div
              className={cn(
                'vx-np-art',
                canvasOn && 'is-canvas',
                swipeFx === 'up' && 'motion-safe:animate-[np-swipe-next_320ms_ease-out]',
                swipeFx === 'down' && 'motion-safe:animate-[np-swipe-prev_320ms_ease-out]',
              )}
            >
              <div
                className="vx-np-art-pane touch-pan-x"
                data-deter-context
                onTouchStart={onArtTouchStart}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={onArtTouchEnd}
              >
                {/* Empty window over the clip while the canvas plays; the still
                    artwork the moment it's off (see SongCanvas). */}
                <SongCanvas canvas={canvas} isPlaying={isPlaying} artUrl={artUrl} hideToggle={chromeHidden} />
                {tapZones}
              </div>
            </div>

            {/* Everything under the clip fades out together in immersive mode. */}
            <div className={cn('vx-np-controls', fadeWhenHidden)} aria-hidden={chromeHidden}>
              <div className="vx-np-title-row">
                <div className="min-w-0 flex-1">
                  <Marquee text={song.title} className="vx-np-title" />
                  {song.artists[0]?.id ? (
                    <Link to={artistPath(song.artists[0])} className="vx-np-artist">{song.subtitle}</Link>
                  ) : (
                    <p className="vx-np-artist">{song.subtitle}</p>
                  )}
                </div>
                <FavButton song={song} />
              </div>

              <div className="vx-np-seek">
                <Seekbar timesBelow remaining />
              </div>

              {/* Main transport */}
              <div className="vx-np-transport">
                <IconButton label={`Shuffle ${shuffle ? 'on' : 'off'}`} onClick={toggleShuffle} active={shuffle} aria-pressed={shuffle} size="lg">
                  <ShuffleIcon className="w-6 h-6" />
                  {shuffle && <span className="vx-np-dot" aria-hidden />}
                </IconButton>
                <IconButton label="Previous" onClick={prev} size="lg">
                  <PrevIcon className="w-9 h-9" />
                </IconButton>
                <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="vx-np-play">
                  {isBuffering ? (
                    <span className="w-6 h-6 border-[3px] border-current border-t-transparent rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <PauseIcon />
                  ) : (
                    <PlayIcon className="ml-1" />
                  )}
                </button>
                <IconButton label="Next" onClick={() => next(true)} size="lg">
                  <NextIcon className="w-9 h-9" />
                </IconButton>
                <IconButton label={`Repeat: ${repeat}`} onClick={cycleRepeat} active={repeat !== 'off'} aria-pressed={repeat !== 'off'} size="lg">
                  <RepeatIcon className="w-6 h-6" />
                  {repeat === 'one' && <span className="absolute top-1.5 right-1.5 text-[10px] font-extrabold">1</span>}
                  {repeat !== 'off' && <span className="vx-np-dot" aria-hidden />}
                </IconButton>
              </div>

              {/* Lyrics · devices · playback options · share · queue */}
              <div className="vx-np-tools">
                <IconButton label="Lyrics" onClick={() => setImmersive(true)} className="vx-np-tool">
                  <MicIcon />
                </IconButton>
                <span className="flex items-center">
                  <IconButton label="Connect to a device" onClick={() => setShowDevices(true)} className="vx-np-tool">
                    <DevicesIcon />
                  </IconButton>
                  {castAvailable && (
                    <span className="vx-np-cast">
                      {/* @ts-expect-error custom element */}
                      <cast-media-route-button style={{ width: '22px', height: '22px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'rgb(var(--ink-200))' }} />
                    </span>
                  )}
                </span>
                <IconButton label="More options" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} className="vx-np-tool">
                  <SlidersIcon />
                </IconButton>
                <IconButton
                  label="Share link"
                  className="vx-np-tool"
                  onClick={() => void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied'))}
                >
                  <ShareIcon />
                </IconButton>
                <Link to="/queue" aria-label="Queue" title="Queue" className="vx-np-tool">
                  <QueueIcon />
                </Link>
              </div>

              {(externalDevice || castDeviceName) && (
                <p className="vx-np-device-line">
                  <DevicesIcon className="w-3.5 h-3.5" aria-hidden /> Playing on {castDeviceName || externalDevice}
                </p>
              )}
            </div>
          </div>

          {/* Up next · lyrics · credits: a panel under the player on phones, the
              right-hand column on wide screens. */}
          <section
            ref={panelRef}
            aria-label="Up next, lyrics and credits"
            className={cn('vx-player-context vx-np-panel transition-opacity duration-300', fadeWhenHidden)}
            aria-hidden={chromeHidden}
          >
            <div className="vx-np-tabbar">
            <div className="vx-np-tabs" role="tablist" aria-label="Player panels">
              <button role="tab" aria-selected={rightTab === 'queue'} onClick={() => pickTab('queue')}>
                Up next
              </button>
              <button role="tab" aria-selected={rightTab === 'lyrics'} onClick={() => pickTab('lyrics')}>
                Lyrics
              </button>
              <button role="tab" aria-selected={rightTab === 'about'} onClick={() => pickTab('about')}>
                Credits
              </button>
            </div>
            {rightTab === 'queue' && <Link to="/queue" className="vx-np-link">Open queue</Link>}
            {rightTab === 'lyrics' && <Link to={`/lyrics/${song.id}`} className="vx-np-link">Full lyrics</Link>}
            </div>

            {rightTab === 'queue' && (
              <div className="vx-np-tabpanel" role="tabpanel" aria-label="Up next">
                <h2 className="sr-only">Up next</h2>
                {upNext.length === 0 && (
                  <p className="text-[15px] text-ink-300 flex items-center gap-2 py-2" role="status">
                    <SparkleIcon className={cn('w-4 h-4 shrink-0', rebuilding && 'animate-pulse')} />
                    {rebuilding ? 'Finding what follows this song…' : 'Add songs with Play next or Add to queue.'}
                  </p>
                )}
                {upNext.map((s, i) => {
                  const line = songLine(s);
                  return (
                    <button key={`${s.id}-${i}`} onClick={() => playAt(index + 1 + i)} className="vx-np-row">
                      <img src={bestImage(s.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
                      <span className="min-w-0 flex-1">
                        {/* Song – Movie/Album – Artist */}
                        <span className="vx-np-row-title">{line.title}</span>
                        <span className="vx-np-row-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
                        {reasons[s.id] && (
                          <span className="vx-np-row-why">
                            <SparkleIcon className="w-3 h-3 shrink-0" aria-hidden />
                            <span>{reasons[s.id]}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}

                {/* C5 / v7.1.0 — pin a mood. It used to set a flag that only nudged the NEXT automatic
                    extension (possibly eight songs away), so tapping a chip changed nothing you could
                    see. Now it rebuilds Up Next at once: songs are fetched FOR the mood, in this
                    queue's language; songs you queued by hand stay where they are. */}
                <div className="vx-np-mood" role="group" aria-label="Pin a mood">
                  <div className="vx-np-subhead">
                    <h3>Pin a mood</h3>
                    <span className="vx-np-meta">Rebuilds Up next · holds 45 min</span>
                  </div>
                  <div className="vx-np-chips">
                    {MOOD_PINS.map(([m, label, intent]) => (
                      <Chip
                        key={m}
                        active={moodPin === m}
                        onClick={() => {
                          const store = usePlayerStore.getState();
                          if (moodPin === m) {
                            clearMoodPin();
                            setMoodPin(null);
                            store.tuneQueue(null);
                            toast('Mood unpinned — Up Next goes back to your usual mix');
                          } else {
                            pinMood(m);
                            setMoodPin(m);
                            store.tuneQueue(intent);
                            toast(`${label} pinned — rebuilding Up Next`);
                          }
                          setRebuilding(true);
                        }}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {rightTab === 'lyrics' && (
              <div className="vx-np-tabpanel is-lyrics" role="tabpanel" aria-label="Lyrics">
                <div className="vx-np-lyrics">{lyricsBody(false)}</div>
              </div>
            )}

            {rightTab === 'about' && (
              <div className="vx-np-tabpanel" role="tabpanel" aria-label="Credits">
                {reasons[song.id] && (
                  <div className="vx-np-about-block">
                    <p className="vx-np-about-label">Why this song</p>
                    <p className="flex items-start gap-2 text-[15px] text-ink-100">
                      <SparkleIcon className="w-4 h-4 mt-0.5 shrink-0 text-ink-300" aria-hidden />
                      <span>{reasons[song.id]}</span>
                    </p>
                  </div>
                )}
                {creditChips.length > 0 && (
                  <div className="vx-np-about-block">
                    <p className="vx-np-about-label">Credits</p>
                    <div className="flex flex-wrap gap-2">
                      {creditChips.map((c) => (
                        <Link key={`${c.role}-${c.name}`} to={c.to} className="vx-np-credit">
                          <span aria-hidden="true">{c.icon}</span>
                          <span className="vx-np-credit-role">{c.role}</span>
                          <span className="truncate">{c.name}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {streamKbps != null && (
                  <div className="vx-np-about-block">
                    <p className="vx-np-about-label">Stream</p>
                    <span className="vx-np-badge tabular-nums">
                      {streamKbps >= 320 ? 'HD · ' : ''}{streamKbps} kbps
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Playback options: volume, speed, sleep, A-B loop, marks, Tune this queue. */}
      <Sheet open={showMore} onClose={() => setShowMore(false)} labelledBy="vx-np-opts-title" size="lg" className="vx-np-opts">
        <h2 id="vx-np-opts-title" className="mb-2">Playback</h2>
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Volume</span>
          <div className="vx-np-opt-controls">
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} size="sm">
              <VolumeIcon className="w-4 h-4" muted={muted} />
            </IconButton>
            <input type="range" aria-label="Volume" aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`} min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
          </div>
        </div>
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Speed</span>
          <div className="vx-np-opt-controls">
            <input
              type="range"
              aria-label="Playback speed"
              min={0.5}
              max={2.5}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              style={{ '--fill': `${((rate - 0.5) / 2) * 100}%` } as React.CSSProperties}
            />
            <span className="w-12 text-right text-[13px] font-bold tabular-nums text-ink-100">{rate.toFixed(2)}x</span>
          </div>
        </div>
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Sleep timer</span>
          <div className="vx-np-opt-controls" role="group" aria-label="Sleep timer">
            {SLEEP_OPTIONS.map((m) => (
              <button key={m} onClick={() => setSleepTimer(m)} className="vx-np-pill">{m}m</button>
            ))}
            <button onClick={() => setSleepAfterTrack(!sleepAfterTrack)} aria-pressed={sleepAfterTrack} className="vx-np-pill">
              End of song
            </button>
            {sleepAt && (
              <button onClick={() => setSleepTimer(null)} className="vx-np-pill is-on">
                Cancel ({Math.max(0, Math.round((sleepAt - Date.now()) / 60_000))}m)
              </button>
            )}
          </div>
        </div>
        {/* v5.12.0 — sleep after N songs */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Sleep after songs</span>
          <div className="vx-np-opt-controls" role="group" aria-label="Sleep after songs">
            {[3, 5, 10].map((n) => (
              <button key={n} onClick={() => setSleepSongs(sleepSongsLeft === n ? 0 : n)} aria-pressed={sleepSongsLeft === n} className="vx-np-pill">
                {n}
              </button>
            ))}
            {sleepSongsLeft > 0 && <span className="text-[13px] font-bold text-ink-200 tabular-nums">{sleepSongsLeft} left</span>}
          </div>
        </div>
        {/* v5.12.0 — A-B repeat: loop any passage */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Loop a passage</span>
          <div className="vx-np-opt-controls" role="group" aria-label="A-B repeat">
            <button onClick={() => setLoopPoint('A')} className={cn('vx-np-pill', loopA != null && 'is-on')}>
              A{loopA != null ? ` ${fmtTime(loopA)}` : ''}
            </button>
            <button onClick={() => setLoopPoint('B')} className={cn('vx-np-pill', loopB != null && 'is-on')}>
              B{loopB != null ? ` ${fmtTime(loopB)}` : ''}
            </button>
            {(loopA != null || loopB != null) && (
              <button onClick={clearLoop} className="vx-np-pill is-quiet">Clear</button>
            )}
          </div>
        </div>
        {/* v5.17.0 — bookmarks: moments to come back to */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Marks</span>
          <div className="vx-np-opt-controls" role="group" aria-label="Bookmarks">
            <BookmarkNowButton songId={song.id} />
            {marks.map((m) => (
              <span key={m} className="inline-flex items-center rounded-full bg-ink-100/10">
                <button onClick={() => seek(m)} className="pl-3 pr-1 min-h-[34px] text-[13px] font-semibold text-ink-100 tabular-nums" title="Jump here">{fmtTime(m)}</button>
                <button onClick={() => removeMark(song.id, m)} aria-label={`Remove bookmark at ${fmtTime(m)}`} className="pl-1 pr-3 min-h-[34px] text-[13px] text-ink-400 hover:text-ink-100">×</button>
              </span>
            ))}
          </div>
        </div>
        {/* v6.5.0 — tune this queue */}
        <div className="vx-np-opt is-block">
          <span className="vx-np-opt-label">Tune this queue</span>
          <TuneChips compact />
        </div>
        {/* v5.17.0 — share this exact moment, ambient mode */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">More</span>
          <div className="vx-np-opt-controls" role="group" aria-label="More options">
            <button onClick={() => { const at = usePlayerStore.getState().currentTime; void shareLink(`${songPath(song)}?t=${Math.floor(at)}`, `${song.title} at ${fmtTime(at)}`).then((r) => r === 'copied' && toast('Link to this moment copied')); }} className="vx-np-pill">Share this moment</button>
            <button onClick={() => setAmbientArmed((v) => !v)} aria-pressed={ambientArmed} className="vx-np-pill" title="After 45 s without touching anything, show a calm artwork-and-clock screen">Ambient mode {ambientArmed ? 'on' : 'off'}</button>
          </div>
        </div>
      </Sheet>

      {/* v5.9.1 — immersive mode is its own layer on <body>, pinned to the
          viewport. Inside the sheet the clip scrolled and dragged with the
          sheet (a black band above the video whenever the page had moved);
          out here it can't. The sheet's backdrop clip yields to this one so
          only one <video> decodes. */}
      {chromeHidden &&
        createPortal(
          <div
            data-vx-overlay
            className="fixed inset-0 z-[60] bg-black select-none touch-pan-x overflow-hidden animate-fade-up"
            data-deter-context
            onTouchStart={onArtTouchStart}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={onArtTouchEnd}
          >
            <SongCanvasBackdrop canvas={canvas} isPlaying={isPlaying} />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
            {tapZones}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 px-6 pt-20 pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none bg-gradient-to-t from-black/85 via-black/45 to-transparent"
            >
              <p className="text-lg font-bold text-white truncate">{song.title}</p>
              <p className="text-sm text-white/70 truncate">{song.subtitle}</p>
              <CanvasProgress />
            </div>
          </div>,
          document.body,
        )}
      {/* Immersive lyrics: a viewport layer on <body>, so it never scrolls with the page. */}
      {immersive &&
        createPortal(
          <div
            ref={immersiveRef}
            role="dialog"
            aria-modal="true"
            aria-label="Immersive lyrics"
            data-vx-overlay
            className="vx-np vx-np-immersive animate-fade-up"
            style={washStyle}
          >
            <StageBackdrop artUrl={artUrl}>
              <div className="vx-np-bg-wash" />
              <div className="vx-np-bg-scrim" />
            </StageBackdrop>
            <div className="vx-np-top px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] w-full max-w-3xl mx-auto">
              <IconButton label="Close lyrics" onClick={() => setImmersive(false)} className="text-ink-100">
                <ChevronDownIcon className="w-6 h-6" />
              </IconButton>
              <span className="vx-np-context">
                <span className="vx-np-context-name">{song.title}</span>
                <span className="vx-np-context-label truncate max-w-full">{song.subtitle}</span>
              </span>
              <span className="w-11" aria-hidden />
            </div>
            <div className="vx-np-lyrics px-4 md:px-8 w-full max-w-3xl mx-auto">{lyricsBody(true)}</div>
            <div className="px-4 md:px-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full max-w-3xl mx-auto">
              <div className="vx-np-seek !mt-2">
                <Seekbar timesBelow remaining />
              </div>
              <div className="flex items-center justify-center gap-10 mt-1">
                <IconButton label="Previous" onClick={prev} size="lg" className="text-ink-100">
                  <PrevIcon className="w-8 h-8" />
                </IconButton>
                <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="vx-np-play !w-16 !h-16">
                  {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-0.5" />}
                </button>
                <IconButton label="Next" onClick={() => next(true)} size="lg" className="text-ink-100">
                  <NextIcon className="w-8 h-8" />
                </IconButton>
              </div>
            </div>
          </div>,
          document.body,
        )}
      <DeviceSheet open={showDevices} onClose={() => setShowDevices(false)} />
      {ambientIdle && song && <AmbientOverlay song={song} onWake={wakeAmbient} />}
    </div>
  );
}
