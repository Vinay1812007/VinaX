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
import { beginArtSwipe, endArtSwipe, moveArtSwipe, swipeFollow, type ArtSwipe } from '@/features/player/artSwipe';
import { UpNextRows } from '@/features/player/UpNextRows';
import { SleepTimerButton, SleepTimerOptions, SleepTimerSheet } from '@/features/player/SleepTimer';
import { StageLyrics } from '@/features/lyrics/StageLyrics';
import type { Mood } from '@/services/recommendation/mood';
import type { ArtistRef, Song } from '@/types';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
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
import { bestImage } from '@/utils/images';
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
import type { TuneIntent } from '@/services/recommendation/tune';
import { cn } from '@/utils/cn';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { reducedMotion, scrollBehavior } from '@/utils/motion';
import '@/styles/pages/player.css';

interface CreditChip {
  role: string;
  name: string;
  to: string;
}

/**
 * v5.5.4 — who-made-this credits, every one clickable. Roles come from the
 * catalog when it provides them (music / singer / lyricist); catalogs that
 * send bare names still get clickable "Artist" credits, and the soundtrack
 * album becomes the "Film" credit.
 */
function buildCreditChips(song: Song, filmTitle: string | null): CreditChip[] {
  const chips: CreditChip[] = [];
  const seen = new Set<string>();
  const push = (role: string, name: string, to: string): void => {
    const k = name.trim().toLowerCase();
    if (!k || seen.has(k) || chips.length >= 5) return;
    seen.add(k);
    chips.push({ role, name, to });
  };
  const linkFor = (a: ArtistRef): string => (a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`);
  const roleOf = (a: ArtistRef): string => (a.role ?? '').toLowerCase();
  for (const a of song.artists) if (/music|compos/.test(roleOf(a))) push('Music', a.name, linkFor(a));
  for (const a of song.artists) if (/sing|vocal/.test(roleOf(a))) push('Singer', a.name, linkFor(a));
  for (const a of song.artists) if (/lyric/.test(roleOf(a))) push('Lyrics', a.name, linkFor(a));
  // Role-less catalog rows: still credit and link every name we have.
  for (const a of song.artists) if (!roleOf(a)) push('Artist', a.name, linkFor(a));
  // v5.6.0 — the film credit no longer needs an album id: when the catalog
  // sends only a name, it searches it, so the movie is ALWAYS tappable.
  if (song.album?.name) {
    chips.push({
      role: 'Film',
      name: filmTitle ?? song.album.name,
      to: song.album.id ? albumPath(song.album) : `/search/${encodeURIComponent(filmTitle ?? song.album.name)}`,
    });
  }
  return chips;
}

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
    <div className="vx-np-canvas-progress">
      <i style={{ transform: `scaleX(${progress})` }} />
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
      type="button"
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/** The stage backdrop: the artwork, heavily blurred, under its own colour.
 *  10.1 — two blurred copies drift slowly against each other (still under
 *  either reduced-motion switch; styles/pages/player.css). */
function StageBackdrop({ artUrl, children }: { artUrl: string | null; children?: React.ReactNode }) {
  return (
    <div className="vx-np-bg" aria-hidden>
      {artUrl && <img src={artUrl} alt="" loading="eager" decoding="async" className="vx-np-bg-art" />}
      {artUrl && <img src={artUrl} alt="" loading="eager" decoding="async" className="vx-np-bg-art is-echo" />}
      {children}
    </div>
  );
}

/** The squircle play button — the deck's and the compact player's shape, at stage size. */
function PlayButton({ isPlaying, isBuffering, onClick, size = 'stage' }: { isPlaying: boolean; isBuffering?: boolean; onClick: () => void; size?: 'stage' | 'compact' }) {
  return (
    <button type="button" onClick={onClick} aria-label={isPlaying ? 'Pause' : 'Play'} className={cn('vx-np-play', size === 'compact' && 'is-compact')}>
      {isBuffering ? <span className="vx-np-spinner" aria-hidden /> : isPlaying ? <PauseIcon /> : <PlayIcon className="vx-np-play-glyph" />}
    </button>
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

type PanelTab = 'queue' | 'lyrics' | 'about';
const TABS: Array<[PanelTab, string]> = [
  ['queue', 'Up next'],
  ['lyrics', 'Lyrics'],
  ['about', 'Credits'],
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
  const loopA = usePlayerStore((s) => s.loopA);
  const loopB = usePlayerStore((s) => s.loopB);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const streamKbps = usePlayerStore((s) => s.streamKbps);
  const { togglePlay, next, prev, cycleRepeat, toggleShuffle, setRate, setVolume, toggleMute, setLoopPoint, clearLoop } =
    usePlayerStore.getState();
  const reasons = useReasonStore((s) => s.reasons);

  const setCurrentAccent = usePlayerStore((s) => s.setCurrentAccent);
  const dynamicTheme = useSettingsStore((s) => s.dynamicTheme);
  const [showMore, setShowMore] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  // v5.17.0 — song bookmarks, ambient mode, data saver.
  const seek = usePlayerStore((s) => s.seek);
  const marks = useBookmarkStore((b) => (song ? b.marks[song.id] : undefined)) ?? [];
  const removeMark = useBookmarkStore((b) => b.remove);
  const dataSaver = useSettingsStore((s) => s.dataSaver);
  const [ambientArmed, setAmbientArmed] = useState(true);
  const [ambientIdle, wakeAmbient] = useIdle(ambientArmed && isPlaying && !showMore && !showDevices && !showSleep);

  // 8.1 — swipe flow: drag the artwork LEFT for the next song, RIGHT for the
  // previous. A vertical drag is the page's to scroll (the pane is touch-pan-y),
  // so nothing here claims it — the up/down fling used to fight the scroll.
  const artSwipe = useRef<(ArtSwipe & { el: HTMLElement }) | null>(null);
  const [swipeFx, setSwipeFx] = useState<'left' | 'right' | null>(null);
  const [rightTab, setRightTab] = useState<PanelTab>('queue');
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
    if (upcomingCount > 0) {
      setRebuilding(false);
      return;
    }
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
  const onArtTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    e.stopPropagation(); // the sheet's dismiss-drag never starts on the artwork
    const t = e.touches[0];
    artSwipe.current = { ...beginArtSwipe(t.clientX, t.clientY), el: e.currentTarget };
  };
  const onArtTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const s = artSwipe.current;
    if (!s) return;
    const t = e.touches[0];
    const follow = moveArtSwipe(s, t.clientX, t.clientY);
    if (follow === null) return; // undecided or vertical: the page scrolls
    e.stopPropagation();
    // The immersive layer is a full-screen black sheet: sliding it would show
    // the page underneath, so only the artwork card follows the finger.
    if (!s.el.classList.contains('vx-np-art-pane')) return;
    s.el.style.transition = 'none';
    s.el.style.transform = `translateX(${follow}px)`;
  };
  const settleArt = (el: HTMLElement) => {
    el.style.transition = '';
    el.style.transform = '';
    el.style.removeProperty('--np-swipe-x');
  };
  const onArtTouchCancel = () => {
    const s = artSwipe.current;
    artSwipe.current = null;
    if (s) settleArt(s.el);
  };
  const onArtTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const s = artSwipe.current;
    artSwipe.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dir = t ? endArtSwipe(s, t.clientX) : null;
    if (!dir) {
      settleArt(s.el); // the pane's own transition snaps it back
      return;
    }
    // Slide out from wherever the drag left the artwork; the keyframe reads it.
    s.el.style.setProperty('--np-swipe-x', `${swipeFollow(s.dx)}px`);
    s.el.style.transform = '';
    setSwipeFx(dir === 'next' ? 'left' : 'right');
    if (dir === 'next') next(true);
    else prev();
    haptic('light');
    const el = s.el;
    window.setTimeout(() => {
      setSwipeFx(null);
      settleArt(el);
    }, 340);
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

  // Slide-up entrance: start off-screen before paint, then rise. Skipped
  // entirely when the listener asked for less motion.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el || reducedMotion()) return;
    el.style.transform = 'translateY(100%)';
    el.style.willChange = 'transform';
    const id = requestAnimationFrame(() => {
      el.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0)';
    });
    const done = () => {
      el.style.willChange = '';
    };
    el.addEventListener('transitionend', done, { once: true });
    return () => {
      cancelAnimationFrame(id);
      el.removeEventListener('transitionend', done);
    };
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
        action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
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
        type="button"
        aria-label={canvasOn ? 'Rewind 10 seconds (double tap), or tap to toggle the controls' : 'Rewind 10 seconds (double tap)'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          doubleSeek(-1);
        }}
        className="vx-np-zone is-left"
      />
      <button
        type="button"
        aria-label={canvasOn ? 'Double tap to favorite, or tap to toggle the controls' : 'Double tap to favorite'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          useLibraryStore.getState().toggleFavorite(song);
          haptic('medium');
        }}
        className="vx-np-zone is-middle"
      />
      <button
        type="button"
        aria-label={canvasOn ? 'Forward 10 seconds (double tap), or tap to toggle the controls' : 'Forward 10 seconds (double tap)'}
        onClick={canvasOn ? onCanvasTap : undefined}
        onDoubleClick={() => {
          cancelTap();
          doubleSeek(1);
        }}
        className="vx-np-zone is-right"
      />
    </>
  );

  // Up next preview: the next six (Pin a mood still fits under them on a
  // desktop); the whole queue is one tap away (Open queue).
  const upNext = queue.slice(index + 1, index + 7);
  const playingFrom = song.album?.name ?? 'Your queue';
  const filmTitle = song.album ? filmTitleFromAlbumName(song.album.name) : null;
  const creditChips = buildCreditChips(song, filmTitle);
  const washStyle = (wash ? { '--np-wash': wash } : undefined) as React.CSSProperties | undefined;
  const leadArtist = song.artists[0];

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

  const pickTab = (tab: PanelTab, focus = false) => {
    tabTouched.current = true;
    setRightTab(tab);
    if (focus) document.getElementById(`vx-np-tab-${tab}`)?.focus();
    // Phone: the panel sits under the player — bring it up into view.
    if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  };
  // Tabs: arrow keys move between them (and select), Home / End jump to the ends.
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = TABS.length - 1;
    const to = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    pickTab(TABS[to][0], true);
  };

  // sheet: drag down to dismiss with the finger, animated slide-down on close.
  const closeSheet = () => {
    const el = sheetRef.current;
    if (!el || reducedMotion()) {
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

  const fadeWhenHidden = chromeHidden && 'is-hidden';
  const playingOn = castDeviceName || externalDevice;

  return (
    <div
      ref={sheetRef}
      className={cn('vx-now-playing vx-np', canvasOn && 'has-canvas')}
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
        <div className="vx-np-bg-wash" />
        {/* v5.8.2 — the scrim thins over a playing clip so the video reads
            instead of drowning, and thins again once the controls are gone.
            It stays bottom-weighted either way, so whatever chrome is still
            on screen keeps its contrast. */}
        <div className={cn('vx-np-bg-scrim', canvasOn && 'is-canvas', chromeHidden && 'is-bare')} />
      </StageBackdrop>

      <div className="vx-np-inner">
        {/* Top bar: close, where this is playing from, the song menu */}
        <header className={cn('vx-np-top', fadeWhenHidden)} aria-hidden={chromeHidden} inert={chromeHidden}>
          <IconButton label="Close player" onClick={closeSheet} className="vx-np-icon">
            <ChevronDownIcon className="w-6 h-6" />
          </IconButton>
          <button type="button" onClick={toggleFullscreen} className="vx-np-context" title="Toggle fullscreen">
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
            <div className={cn('vx-np-art', canvasOn && 'is-canvas')}>
              <div
                className={cn(
                  'vx-np-art-pane touch-pan-y',
                  swipeFx === 'left' && 'motion-safe:animate-[np-swipe-left_320ms_ease-out]',
                  swipeFx === 'right' && 'motion-safe:animate-[np-swipe-right_320ms_ease-out]',
                )}
                data-deter-context
                onTouchStart={onArtTouchStart}
                onTouchMove={onArtTouchMove}
                onTouchEnd={onArtTouchEnd}
                onTouchCancel={onArtTouchCancel}
              >
                {/* Empty window over the clip while the canvas plays; the still
                    artwork the moment it's off (see SongCanvas). */}
                <SongCanvas canvas={canvas} isPlaying={isPlaying} artUrl={artUrl} hideToggle={chromeHidden} />
                {tapZones}
              </div>
            </div>

            {/* Everything under the clip fades out together in immersive mode. */}
            <div className={cn('vx-np-controls', fadeWhenHidden)} aria-hidden={chromeHidden} inert={chromeHidden}>
              <div className="vx-np-title-row">
                <div className="vx-np-title-block">
                  <h1 className="vx-np-title">
                    <Marquee text={song.title} />
                  </h1>
                  {leadArtist?.id ? (
                    <Link to={artistPath(leadArtist)} className="vx-np-artist">
                      {song.subtitle}
                    </Link>
                  ) : (
                    <p className="vx-np-artist">{song.subtitle}</p>
                  )}
                </div>
                <span className="vx-np-like">
                  <FavButton song={song} />
                </span>
              </div>

              <div className="vx-np-seek">
                <Seekbar timesBelow remaining />
              </div>

              {/* Main transport */}
              <div className="vx-np-transport">
                <IconButton
                  label={`Shuffle ${shuffle ? 'on' : 'off'}`}
                  onClick={toggleShuffle}
                  active={shuffle}
                  aria-pressed={shuffle}
                  size="lg"
                  className="vx-np-mode"
                >
                  <ShuffleIcon className="w-6 h-6" />
                  {shuffle && <span className="vx-np-dot" aria-hidden />}
                </IconButton>
                <IconButton label="Previous" onClick={prev} size="lg" className="vx-np-skip">
                  <PrevIcon className="w-8 h-8" />
                </IconButton>
                <PlayButton isPlaying={isPlaying} isBuffering={isBuffering} onClick={togglePlay} />
                <IconButton label="Next" onClick={() => next(true)} size="lg" className="vx-np-skip">
                  <NextIcon className="w-8 h-8" />
                </IconButton>
                <IconButton
                  label={`Repeat: ${repeat}`}
                  onClick={cycleRepeat}
                  active={repeat !== 'off'}
                  aria-pressed={repeat !== 'off'}
                  size="lg"
                  className="vx-np-mode"
                >
                  <RepeatIcon className="w-6 h-6" />
                  {repeat === 'one' && (
                    <span className="vx-np-repeat-one" aria-hidden>
                      1
                    </span>
                  )}
                  {repeat !== 'off' && <span className="vx-np-dot" aria-hidden />}
                </IconButton>
              </div>

              {/* Lyrics · output · sleep · share · queue · playback options */}
              <div className="vx-np-tools">
                <IconButton label="Lyrics" onClick={() => setImmersive(true)} className="vx-np-tool">
                  <MicIcon />
                </IconButton>
                <span className="vx-np-tool-group">
                  <IconButton
                    label={playingOn ? `Connect to a device. Playing on ${playingOn}` : 'Connect to a device'}
                    onClick={() => setShowDevices(true)}
                    className={cn('vx-np-tool', playingOn && 'is-live')}
                  >
                    <DevicesIcon />
                  </IconButton>
                  {castAvailable && (
                    <span className="vx-np-cast">
                      {/* @ts-expect-error custom element */}
                      <cast-media-route-button style={{ width: '22px', height: '22px', '--connected-color': 'rgb(var(--ember-400))', '--disconnected-color': 'rgb(var(--ink-200))' }} />
                    </span>
                  )}
                </span>
                <SleepTimerButton open={showSleep} onOpen={() => setShowSleep(true)} />
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
                {/* 10.1 — "Player tools", not "More options": the song's own ⋮ menu already carries that name, and two controls with one name confused screen readers and the guided tour. */}
                <IconButton label="Player tools" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} className="vx-np-tool">
                  <SlidersIcon />
                </IconButton>
              </div>

              {playingOn && (
                <p className="vx-np-device-line">
                  <span className="vx-np-live-dot" aria-hidden />
                  Playing on {playingOn}
                </p>
              )}
            </div>
          </div>

          {/* Up next · lyrics · credits: a panel under the player on phones, the
              right-hand column on wide screens. */}
          <section ref={panelRef} aria-label="Up next, lyrics and credits" className={cn('vx-np-panel', fadeWhenHidden)} aria-hidden={chromeHidden} inert={chromeHidden}>
            <div className="vx-np-tabbar">
              <div className="vx-np-tabs" role="tablist" aria-label="Player panels">
                {TABS.map(([tab, label], i) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`vx-np-tab-${tab}`}
                    aria-selected={rightTab === tab}
                    aria-controls={`vx-np-panel-${tab}`}
                    tabIndex={rightTab === tab ? 0 : -1}
                    onClick={() => pickTab(tab)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {rightTab === 'queue' && (
                <Link to="/queue" className="vx-np-link">
                  Open queue
                </Link>
              )}
              {rightTab === 'lyrics' && (
                <Link to={`/lyrics/${song.id}`} className="vx-np-link">
                  Full lyrics
                </Link>
              )}
            </div>

            {rightTab === 'queue' && (
              <div className="vx-np-tabpanel" role="tabpanel" id="vx-np-panel-queue" aria-labelledby="vx-np-tab-queue">
                <h2 className="sr-only">Up next</h2>
                {upNext.length === 0 ? (
                  <p className="vx-np-empty" role="status">
                    <SparkleIcon className={cn('w-4 h-4 shrink-0', rebuilding && 'animate-pulse')} />
                    {rebuilding ? 'Finding what follows this song…' : 'Add songs with Play next or Add to queue.'}
                  </p>
                ) : (
                  <UpNextRows songs={upNext} start={index + 1} variant="stage" />
                )}

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
              <div className="vx-np-tabpanel is-lyrics" role="tabpanel" id="vx-np-panel-lyrics" aria-labelledby="vx-np-tab-lyrics">
                <div className="vx-np-lyrics">
                  <StageLyrics lyrics={lyrics} layer="panel" />
                </div>
              </div>
            )}

            {rightTab === 'about' && (
              <div className="vx-np-tabpanel" role="tabpanel" id="vx-np-panel-about" aria-labelledby="vx-np-tab-about">
                {reasons[song.id] && (
                  <div className="vx-np-about-block">
                    <h3 className="vx-np-about-label">Why this song</h3>
                    <p className="vx-np-why">
                      <SparkleIcon className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{reasons[song.id]}</span>
                    </p>
                  </div>
                )}
                {creditChips.length > 0 && (
                  <div className="vx-np-about-block">
                    <h3 className="vx-np-about-label">Credits</h3>
                    <ul className="vx-np-credits">
                      {creditChips.map((c) => (
                        <li key={`${c.role}-${c.name}`}>
                          <Link to={c.to} className="vx-np-credit">
                            <span className="vx-np-credit-role">{c.role}</span>
                            <span className="vx-np-credit-name">{c.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {streamKbps != null && (
                  <div className="vx-np-about-block">
                    <h3 className="vx-np-about-label">Stream</h3>
                    <span className="vx-np-badge tabular-nums">
                      {streamKbps >= 320 ? 'HD · ' : ''}
                      {streamKbps} kbps
                    </span>
                  </div>
                )}
                {!reasons[song.id] && creditChips.length === 0 && streamKbps == null && (
                  <p className="vx-np-empty">No credits for this song yet.</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* More options: volume, speed, sleep, A-B loop, marks, Tune this queue. */}
      <Sheet open={showMore} onClose={() => setShowMore(false)} labelledBy="vx-np-opts-title" size="lg" className="vx-np-opts">
        <SheetHeader id="vx-np-opts-title" title="Playback" onClose={() => setShowMore(false)} />
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Volume</span>
          <div className="vx-np-opt-controls">
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
              style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
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
            <span className="vx-np-opt-value w-12 text-right tabular-nums">{rate.toFixed(2)}x</span>
          </div>
        </div>
        <SleepTimerOptions />
        {/* v5.12.0 — A-B repeat: loop any passage */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Loop a passage</span>
          <div className="vx-np-opt-controls" role="group" aria-label="A-B repeat">
            <button type="button" onClick={() => setLoopPoint('A')} className={cn('vx-np-pill', loopA != null && 'is-on')}>
              A{loopA != null ? ` ${fmtTime(loopA)}` : ''}
            </button>
            <button type="button" onClick={() => setLoopPoint('B')} className={cn('vx-np-pill', loopB != null && 'is-on')}>
              B{loopB != null ? ` ${fmtTime(loopB)}` : ''}
            </button>
            {(loopA != null || loopB != null) && (
              <button type="button" onClick={clearLoop} className="vx-np-pill is-quiet">
                Clear
              </button>
            )}
          </div>
        </div>
        {/* v5.17.0 — bookmarks: moments to come back to */}
        <div className="vx-np-opt">
          <span className="vx-np-opt-label">Marks</span>
          <div className="vx-np-opt-controls" role="group" aria-label="Bookmarks">
            <BookmarkNowButton songId={song.id} />
            {marks.map((m) => (
              <span key={m} className="vx-np-mark">
                <button type="button" onClick={() => seek(m)} className="vx-np-mark-time tabular-nums" title="Jump here">
                  {fmtTime(m)}
                </button>
                <button type="button" onClick={() => removeMark(song.id, m)} aria-label={`Remove bookmark at ${fmtTime(m)}`} className="vx-np-mark-remove">
                  ×
                </button>
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
          <div className="vx-np-opt-controls" role="group" aria-label="Player tools">
            <button
              type="button"
              onClick={() => {
                const at = usePlayerStore.getState().currentTime;
                void shareLink(`${songPath(song)}?t=${Math.floor(at)}`, `${song.title} at ${fmtTime(at)}`).then((r) => r === 'copied' && toast('Link to this moment copied'));
              }}
              className="vx-np-pill"
            >
              Share this moment
            </button>
            <button
              type="button"
              onClick={() => setAmbientArmed((v) => !v)}
              aria-pressed={ambientArmed}
              className="vx-np-pill"
              title="After 45 s without touching anything, show a calm artwork-and-clock screen"
            >
              Ambient mode {ambientArmed ? 'on' : 'off'}
            </button>
          </div>
        </div>
      </Sheet>

      <SleepTimerSheet open={showSleep} onClose={() => setShowSleep(false)} />

      {/* v5.9.1 — immersive mode is its own layer on <body>, pinned to the
          viewport. Inside the sheet the clip scrolled and dragged with the
          sheet (a black band above the video whenever the page had moved);
          out here it can't. The sheet's backdrop clip yields to this one so
          only one <video> decodes. */}
      {chromeHidden &&
        createPortal(
          <div
            data-vx-overlay
            className="vx-np-canvas-layer"
            data-deter-context
            onTouchStart={onArtTouchStart}
            onTouchMove={onArtTouchMove}
            onTouchEnd={onArtTouchEnd}
            onTouchCancel={onArtTouchCancel}
          >
            <SongCanvasBackdrop canvas={canvas} isPlaying={isPlaying} />
            <div aria-hidden className="vx-np-canvas-shade" />
            {tapZones}
            <div aria-hidden className="vx-np-canvas-caption">
              <p className="vx-np-canvas-title">{song.title}</p>
              <p className="vx-np-canvas-artist">{song.subtitle}</p>
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
            className="vx-np vx-np-immersive"
            style={washStyle}
          >
            <StageBackdrop artUrl={artUrl}>
              <div className="vx-np-bg-wash" />
              <div className="vx-np-bg-scrim" />
            </StageBackdrop>
            <div className="vx-np-immersive-top">
              <IconButton label="Close lyrics" onClick={() => setImmersive(false)} className="vx-np-icon">
                <ChevronDownIcon className="w-6 h-6" />
              </IconButton>
              <span className="vx-np-context">
                <span className="vx-np-context-name">{song.title}</span>
                <span className="vx-np-context-label">{song.subtitle}</span>
              </span>
              <span className="vx-np-immersive-spacer" aria-hidden />
            </div>
            <div className="vx-np-lyrics vx-np-immersive-lyrics">
              <StageLyrics lyrics={lyrics} layer="immersive" />
            </div>
            <div className="vx-np-immersive-controls">
              <div className="vx-np-seek">
                <Seekbar timesBelow remaining />
              </div>
              <div className="vx-np-immersive-transport">
                <IconButton label="Previous" onClick={prev} size="lg" className="vx-np-skip">
                  <PrevIcon className="w-8 h-8" />
                </IconButton>
                <PlayButton isPlaying={isPlaying} onClick={togglePlay} size="compact" />
                <IconButton label="Next" onClick={() => next(true)} size="lg" className="vx-np-skip">
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
