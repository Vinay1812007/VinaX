import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import type { Video } from '@/services/api/videos';
import { getSong } from '@/services/api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useTogether } from '@/services/together/session';
import { ReelCard } from '@/features/flow/ReelCard';
import { useFlowReels } from '@/features/flow/useFlowReels';
import { flowVideoPath, markSeen } from '@/features/flow/reels';
import { requireAccount } from '@/services/auth/gate';
import { ChevronDownIcon, VolumeIcon, XIcon } from '@/components/Icons';
import { shareLink } from '@/utils/share';
import { reducedMotion } from '@/utils/motion';
import '@/styles/pages/flow.css';

/** The first-run "Swipe up" hint, shown once per device. */
export const FLOW_HINT_KEY = 'vinax.flow.hint.v1';
/** Flow's sound choice, kept for the next visit. */
export const FLOW_MUTED_KEY = 'vinax.flow.muted.v1';
/** A reel is "on screen" once this much of it shows. */
const VISIBLE_RATIO = 0.6;
/** A reel on screen this long counts as watched (it goes after unseen ones next visit). */
const SEEN_MS = 3_000;
/** Load more when the listener is this close to the end. */
const NEAR_END = 4;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* the choice lasts for this visit */
  }
}

/** The song behind a video, from the catalogue (one request per song, shared by every action). */
const songCache = new Map<string, Promise<Song>>();
function songFor(video: Video): Promise<Song> {
  const id = video.songIds[0];
  if (!id) return Promise.reject(new Error('no song'));
  let p = songCache.get(id);
  if (!p) {
    p = getSong(id);
    songCache.set(id, p);
    p.catch(() => songCache.delete(id));
  }
  return p;
}

/**
 * 1.14.4 "Flow" — music videos, one per screen, like reels.
 *
 * Vertical scroll-snap with native momentum on phones; the wheel, ↑/↓,
 * PageUp/PageDown and j/k with a keyboard; M switches the sound. The reel on
 * screen plays from the start, with sound when the browser allows it (else
 * muted, with a "Tap for sound" button), and when it ends the feed moves to
 * the next one. The reel after it loads in the background.
 *
 * The music steps aside while a reel plays (it pauses, and stays where it
 * was). "Play the song" hands the video's song to the music player. In a
 * Listen Together session Flow never touches the music: reels play muted
 * unless the listener turns the sound on themselves.
 *
 * Before 1.14.4 Flow was a feed of 30-second song previews.
 *
 * 1.17.2 — /flow?v=<id> opens on that video, then the normal feed follows.
 * It is the one video player: Videos cards and shared links open here, and
 * the old /video/<id> player redirects here. A shared link opens signed
 * out (AuthGate); playing the song, liking or queueing asks to sign in.
 */
export default function FlowPage() {
  usePageTitle('Flow');
  const navigate = useNavigate();
  const location = useLocation();
  const inSession = useTogether((s) => s.mode !== 'idle');
  const following = usePlayerStore((s) => s.followMode);
  const locked = inSession || following;
  const startId = new URLSearchParams(location.search).get('v')?.trim() || null;
  const { reels, loading, done, failed: loadFailed, leadMissing, more, retry } = useFlowReels(startId);
  const [reduceMotion] = useState(reducedMotion);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(() => locked || readFlag(FLOW_MUTED_KEY, false));
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [showHint, setShowHint] = useState(() => !readFlag(FLOW_HINT_KEY, false));
  const [announce, setAnnounce] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const reelsRef = useRef(reels);
  reelsRef.current = reels;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (leadMissing) toast('That video couldn’t be loaded. Here are others.');
  }, [leadMissing]);

  useEffect(() => {
    if (showHint) writeFlag(FLOW_HINT_KEY, true);
  }, [showHint]);
  useEffect(() => {
    if (active > 0) setShowHint(false);
  }, [active]);

  /* ---------------------------------------------------------- which reel */
  useEffect(() => {
    const root = feedRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= VISIBLE_RATIO) {
            setActive(Number((e.target as HTMLElement).dataset.flowIndex ?? 0));
          }
        }
      },
      { root, threshold: [VISIBLE_RATIO] },
    );
    root.querySelectorAll('[data-flow-index]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reels.length]);

  const activeId = reels[active]?.id ?? null;
  useEffect(() => {
    if (!activeId) return;
    const t = window.setTimeout(() => markSeen(activeId), SEEN_MS);
    return () => window.clearTimeout(t);
  }, [activeId]);

  const nearEnd = reels.length - active <= NEAR_END;
  useEffect(() => {
    if (nearEnd && !done) void more();
  }, [nearEnd, done, more, reels.length]);

  const scrollToCard = useCallback((index: number) => {
    const root = feedRef.current;
    const count = reelsRef.current.length;
    if (!root || !count) return;
    const target = Math.min(count - 1, Math.max(0, index));
    root.scrollTo({ top: target * root.clientHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [reduceMotion]);
  const go = useCallback((delta: number) => scrollToCard(activeRef.current + delta), [scrollToCard]);

  /* ------------------------------------------------------------ playback */
  const onPlaying = useCallback(() => {
    if (locked) return;
    // The music steps aside while a reel plays.
    const st = usePlayerStore.getState();
    if (st.isPlaying) st.togglePlay();
  }, [locked]);
  const onEnded = useCallback((v: Video) => {
    if (reelsRef.current[activeRef.current]?.id === v.id) go(1);
  }, [go]);
  const onFailed = useCallback((v: Video) => {
    setFailed((f) => new Set(f).add(v.id));
    if (!reduceMotion && reelsRef.current[activeRef.current]?.id === v.id) window.setTimeout(() => go(1), 600);
  }, [go, reduceMotion]);
  const onAutoplayBlocked = useCallback(() => {
    setMuted(true);
    setBlocked(true);
  }, []);
  const toggleMute = useCallback(() => {
    setBlocked(false);
    setMuted((m) => {
      writeFlag(FLOW_MUTED_KEY, !m);
      return !m;
    });
  }, []);

  /* ------------------------------------------------------------- actions */
  const onLike = useCallback((v: Video) => {
    if (!v.songIds.length) return;
    void songFor(v).then(
      (song) => {
        const lib = useLibraryStore.getState();
        // Signed out (a shared link): the sign-in sheet, and the like once they have.
        const like = () => {
          const l = useLibraryStore.getState();
          if (!l.isFavorite(song.id)) l.toggleFavorite(song);
        };
        if (!lib.isFavorite(song.id) && !requireAccount('save', like)) return;
        if (!lib.isFavorite(song.id)) lib.toggleFavorite(song);
        setAnnounce(`Liked ${song.title}`);
      },
      () => toast('Could not like this song right now'),
    );
  }, []);
  const onPlaySong = useCallback((v: Video) => {
    void songFor(v).then(
      (song) => {
        // Signed out (a shared link), the same steps run once they have signed in,
        // so the reel still pauses and the song does not play over it.
        const play = () => {
          feedRef.current?.querySelectorAll('video').forEach((el) => el.pause());
          usePlayerStore.getState().playSong(song);
          toast(`Playing ${song.title}`);
          navigate('/now-playing');
        };
        if (requireAccount('listen', play)) play();
      },
      () => toast('Could not load the song right now'),
    );
  }, [navigate]);
  const onAddToQueue = useCallback((v: Video) => {
    void songFor(v).then(
      (song) => {
        const add = () => {
          usePlayerStore.getState().enqueue(song);
          toast(`Added ${song.title} to the queue`);
        };
        if (requireAccount('listen', add)) add();
      },
      () => toast('Could not add this song right now'),
    );
  }, []);
  const onShare = useCallback((v: Video) => {
    void shareLink(flowVideoPath(v.id), v.title).then((r) => r === 'copied' && toast('Link copied'));
  }, []);

  const close = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }, [location.key, navigate]);

  /* ------------------------------------------------- keyboard and wheel */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest('[role="menu"], [role="dialog"]')) return;
      let handled = true;
      switch (e.key) {
        case 'ArrowDown':
        case 'PageDown':
        case 'j':
          go(1);
          break;
        case 'ArrowUp':
        case 'PageUp':
        case 'k':
          go(-1);
          break;
        case 'm':
          toggleMute();
          break;
        case 'Escape':
          close();
          break;
        case ' ': {
          if (t?.closest('button, a')) return; // the focused control takes its own Space
          const el = feedRef.current?.querySelector<HTMLVideoElement>(`[data-flow-index="${activeRef.current}"] video`);
          if (el) {
            if (el.paused) void el.play().catch(() => undefined);
            else el.pause();
          }
          break;
        }
        default:
          handled = false;
      }
      if (!handled) return;
      // Flow owns these keys while it is open (the app-wide ↑/↓ would change the volume).
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, close, toggleMute]);

  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    // One reel per wheel gesture: a trackpad flick sends dozens of events with momentum.
    let lockedUntil = 0;
    let lastEvent = 0;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = performance.now();
      const quietGap = now - lastEvent > 180;
      lastEvent = now;
      if (now < lockedUntil && !quietGap) return;
      if (Math.abs(e.deltaY) < 4) return;
      lockedUntil = now + 450;
      go(e.deltaY > 0 ? 1 : -1);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [go]);

  const total = reels.length;

  const layer = (
    <div className="vx-flow" role="region" aria-label="Flow">
      <header className="vx-flow-top">
        <button type="button" className="vx-flow-icon" aria-label="Close Flow" onClick={close}>
          <XIcon className="w-5 h-5" />
        </button>
        <h1 className="vx-flow-name">Flow</h1>
        <div className="vx-flow-step">
          <button type="button" className="vx-flow-icon" aria-label="Previous video" disabled={active === 0} onClick={() => go(-1)}>
            <ChevronDownIcon className="w-5 h-5 rotate-180" />
          </button>
          <button type="button" className="vx-flow-icon" aria-label="Next video" disabled={active >= total - 1} onClick={() => go(1)}>
            <ChevronDownIcon className="w-5 h-5" />
          </button>
        </div>
      </header>
      {locked && (
        <p className="vx-flow-notice" role="status">
          You're in a Listen Together session, so Flow won't change what's playing and videos start muted. <Link to="/together">Open the session</Link>.
        </p>
      )}
      {blocked && muted && total > 0 && (
        <button type="button" className="vx-reel-sound" onClick={toggleMute}>
          <VolumeIcon className="w-5 h-5" muted /> Tap for sound
        </button>
      )}
      <div ref={feedRef} className="vx-flow-feed">
        {reels.map((v, i) => (
          <ReelCard
            key={v.id}
            video={v}
            index={i}
            total={total}
            active={i === active && !failed.has(v.id)}
            next={i === active + 1}
            near={Math.abs(i - active) <= 2}
            muted={muted}
            reduceMotion={reduceMotion}
            hint={showHint && i === 0 && active === 0}
            onAutoplayBlocked={onAutoplayBlocked}
            onPlaying={onPlaying}
            onEnded={onEnded}
            onFailed={onFailed}
            onToggleMute={toggleMute}
            onLike={onLike}
            onPlaySong={onPlaySong}
            onAddToQueue={onAddToQueue}
            onShare={onShare}
          />
        ))}
        {total === 0 && (
          <div className="vx-flow-card vx-flow-empty">
            {loading || !done ? (
              <p role="status">Finding videos for you…</p>
            ) : loadFailed ? (
              <p role="status">
                Couldn’t load videos. Check your connection, then{' '}
                <button type="button" className="vx-flow-retry" onClick={retry}>
                  try again
                </button>
                .
              </p>
            ) : (
              <p role="status">
                No videos to show right now. Check your connection, or <Link to="/videos">browse Videos</Link>.
              </p>
            )}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
  return createPortal(layer, document.body);
}
