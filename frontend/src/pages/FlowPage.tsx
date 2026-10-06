import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useTogether } from '@/services/together/session';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { FlowCard } from '@/features/flow/FlowCard';
import { FlowEndless, useFlowFeed } from '@/features/flow/useFlowFeed';
import { createShownRecorder } from '@/features/flow/feed';
import { hookPoint, previewEnd } from '@/features/flow/hookPoint';
import { ChevronDownIcon, XIcon } from '@/components/Icons';
import { shareLink } from '@/utils/share';
import { songPath } from '@/utils/slug';
import { reducedMotion } from '@/utils/motion';
import '@/styles/pages/flow.css';

/** The first-run "Swipe up" hint, shown once per device. */
export const FLOW_HINT_KEY = 'vinax.flow.hint.v1';
/** A card is "on screen" once this much of it shows. */
const VISIBLE_RATIO = 0.6;
/** How long a card has to stay on screen before it counts as settled (and plays). */
const SETTLE_MS = 220;
/** How long a settled card waits for its lyrics before starting at the 30% mark instead. */
const LYRICS_WAIT_MS = 900;
/** Load more when the listener is this close to the end. */
const NEAR_END = 4;

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(FLOW_HINT_KEY) === '1';
  } catch {
    return true; // no storage: never nag
  }
}
function markHintSeen(): void {
  try {
    window.localStorage.setItem(FLOW_HINT_KEY, '1');
  } catch {
    /* the hint simply shows again next time */
  }
}

/**
 * 10.1 "Flow" — a full-screen, swipeable feed of song previews.
 *
 * One card per screen (vertical scroll-snap, native momentum on phones;
 * wheel, ↑/↓, PageUp/PageDown and j/k on a keyboard). The card that settles
 * plays a preview from its hook (the first chorus line when synced lyrics
 * show one, else 30% in) for about 30 seconds, then the feed moves on.
 *
 * Playback runs in the player's PREVIEW mode: the listener's queue is set
 * aside when Flow starts and comes back, paused where it was, when they
 * leave. "Play full song" and "Add to queue" hand a song to that real queue;
 * nothing is auto-extended or learned from a preview. In a Listen Together
 * session Flow never takes over the music.
 */
export default function FlowPage() {
  usePageTitle('Flow');
  const navigate = useNavigate();
  const location = useLocation();
  const inSession = useTogether((s) => s.mode !== 'idle');
  const following = usePlayerStore((s) => s.followMode);
  const locked = inSession || following;
  const { songs, starting, onEndless } = useFlowFeed();
  const [reduceMotion] = useState(reducedMotion);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState<number | null>(null);
  /** Previews start on their own until the listener plays a full song (then they ask). */
  const [autoPreview, setAutoPreview] = useState(true);
  const [win, setWin] = useState<{ id: string; start: number; end: number } | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [showHint, setShowHint] = useState(() => !hintSeen());
  const [lyricsWaitOver, setLyricsWaitOver] = useState(false);
  const [announce, setAnnounce] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const startedFor = useRef<string | null>(null);
  const windowDone = useRef(false);
  const recordShown = useMemo(() => createShownRecorder(), []);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const activeRef = useRef(active);
  activeRef.current = active;

  const activeSong = songs[active] ?? null;
  const settledSong = settled != null ? songs[settled] ?? null : null;
  const lyrics = useSyncedLyrics(activeSong);
  // The next card's lyrics load while this one plays, so its hook is ready when it settles.
  useSyncedLyrics(songs[active + 1] ?? null);

  // Leaving Flow gives the listener their own queue back, paused where it was.
  useEffect(() => () => usePlayerStore.getState().exitPreview(), []);

  useEffect(() => {
    if (showHint) markHintSeen();
  }, [showHint]);
  useEffect(() => {
    if (active > 0) setShowHint(false);
  }, [active]);

  /* ---------------------------------------------------------- which card */
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
  }, [songs.length]);

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(active), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  useEffect(() => {
    setLyricsWaitOver(false);
    const t = window.setTimeout(() => setLyricsWaitOver(true), LYRICS_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [settledSong?.id]);

  /* ------------------------------------------------------------ playback */
  const startPreview = useCallback((song: Song, lines: Parameters<typeof hookPoint>[1]) => {
    const player = usePlayerStore.getState();
    if (!player.enterPreview()) return;
    const start = hookPoint(song.duration, lines);
    startedFor.current = song.id;
    windowDone.current = false;
    setWin({ id: song.id, start, end: previewEnd(start, song.duration) });
    player.previewSong(song, start);
  }, []);

  const lyricsReady = lyrics.isFetched || lyrics.isError || lyricsWaitOver;
  const syncedLines = lyrics.data?.synced ?? null;
  useEffect(() => {
    if (!settledSong || settled !== active) return;
    // The ledger's contract: an impression is a card that settled on screen.
    recordShown(settledSong);
    if (locked || !autoPreview || startedFor.current === settledSong.id || failed.has(settledSong.id)) return;
    if (!lyricsReady) return;
    startPreview(settledSong, syncedLines);
  }, [settledSong, settled, active, locked, autoPreview, failed, lyricsReady, syncedLines, recordShown, startPreview]);

  const scrollToCard = useCallback((index: number) => {
    const root = feedRef.current;
    const count = songsRef.current.length;
    if (!root || !count) return;
    const target = Math.min(count - 1, Math.max(0, index));
    root.scrollTo({ top: target * root.clientHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [reduceMotion]);
  const go = useCallback((delta: number) => scrollToCard(activeRef.current + delta), [scrollToCard]);

  // The preview window: when it closes (or the song ends, or cannot play), the feed moves on —
  // unless the listener asked for less motion, in which case the song simply pauses.
  useEffect(
    () =>
      usePlayerStore.subscribe((s, prev) => {
        if (!s.previewMode || !win) return;
        const current = s.queue[s.index];
        if (current?.id !== win.id || windowDone.current) return;
        if (s.previewError === win.id) {
          windowDone.current = true;
          setFailed((f) => new Set(f).add(win.id));
          if (!reduceMotion) window.setTimeout(() => go(1), 600);
          return;
        }
        const pastWindow = s.currentTime >= win.end - 0.25 && s.currentTime > prev.currentTime;
        const songEnded = prev.isPlaying && !s.isPlaying && s.duration > 0 && s.currentTime >= s.duration - 1;
        if (!pastWindow && !songEnded) return;
        windowDone.current = true;
        if (reduceMotion) {
          if (s.isPlaying) s.togglePlay();
          return;
        }
        if (activeRef.current < songsRef.current.length - 1) go(1);
        else if (s.isPlaying) s.togglePlay();
      }),
    [win, go, reduceMotion],
  );

  /* ------------------------------------------------------------- actions */
  const linesRef = useRef<{ id: string | null; lines: typeof syncedLines }>({ id: null, lines: null });
  linesRef.current = { id: activeSong?.id ?? null, lines: syncedLines };
  const onTogglePlay = useCallback((song: Song) => {
    if (locked) return;
    const player = usePlayerStore.getState();
    const lines = linesRef.current.id === song.id ? linesRef.current.lines : null;
    if (player.queue[player.index]?.id === song.id) {
      if (player.previewMode && windowDone.current && !player.isPlaying) {
        // A finished preview plays its window again.
        startPreview(song, lines);
        return;
      }
      player.togglePlay();
      return;
    }
    setAutoPreview(true);
    startPreview(song, lines);
  }, [locked, startPreview]);

  const onPlayFull = useCallback((song: Song) => {
    setAutoPreview(false);
    usePlayerStore.getState().commitPreview(song);
    toast(`Playing ${song.title}`);
  }, []);
  const onAddToQueue = useCallback((song: Song) => usePlayerStore.getState().enqueue(song), []);
  const onShare = useCallback((song: Song) => {
    void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied'));
  }, []);
  const onMoreLikeThis = useCallback((song: Song) => {
    usePlayerStore.getState().startRadio(song);
    navigate('/now-playing');
  }, [navigate]);
  const onLike = useCallback((song: Song) => {
    const lib = useLibraryStore.getState();
    if (!lib.isFavorite(song.id)) lib.toggleFavorite(song);
    setAnnounce(`Liked ${song.title}`);
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
        case 'Escape':
          close();
          break;
        case ' ':
          if (t?.closest('button, a')) return; // the focused control takes its own Space
          if (activeSong) onTogglePlay(activeSong);
          break;
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
  }, [go, close, activeSong, onTogglePlay]);

  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    // One card per wheel gesture: a trackpad flick sends dozens of events with momentum.
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

  const nearEnd = !starting && songs.length - active <= NEAR_END;
  const total = songs.length;

  const layer = (
    <div className="vx-flow" role="region" aria-label="Flow">
      <header className="vx-flow-top">
        <button type="button" className="vx-flow-icon" aria-label="Close Flow" onClick={close}>
          <XIcon className="w-5 h-5" />
        </button>
        <h1 className="vx-flow-name">Flow</h1>
        <div className="vx-flow-step">
          <button type="button" className="vx-flow-icon" aria-label="Previous song" disabled={active === 0} onClick={() => go(-1)}>
            <ChevronDownIcon className="w-5 h-5 rotate-180" />
          </button>
          <button type="button" className="vx-flow-icon" aria-label="Next song" disabled={active >= total - 1} onClick={() => go(1)}>
            <ChevronDownIcon className="w-5 h-5" />
          </button>
        </div>
      </header>
      {locked && (
        <p className="vx-flow-notice" role="status">
          You're in a Listen Together session, so Flow won't change what's playing. Browse here and add songs to the queue — <Link to="/together">open the session</Link>.
        </p>
      )}
      <div ref={feedRef} className="vx-flow-feed">
        {songs.map((song, i) => (
          <FlowCard
            key={song.id}
            song={song}
            index={i}
            total={total}
            near={Math.abs(i - active) <= 2}
            active={i === active}
            window={win && win.id === song.id && i === active ? win : null}
            lines={i === active ? syncedLines : null}
            failed={failed.has(song.id)}
            locked={locked}
            reduceMotion={reduceMotion}
            hint={showHint && i === 0 && active === 0}
            onTogglePlay={onTogglePlay}
            onPlayFull={onPlayFull}
            onAddToQueue={onAddToQueue}
            onShare={onShare}
            onMoreLikeThis={onMoreLikeThis}
            onLike={onLike}
          />
        ))}
        {total === 0 && (
          <div className="vx-flow-card vx-flow-empty">
            {starting || nearEnd ? (
              <p role="status">Finding songs for you…</p>
            ) : (
              <p role="status">
                Nothing to show right now. Check your connection, or <Link to="/discover">browse Discover</Link>.
              </p>
            )}
          </div>
        )}
      </div>
      {nearEnd && <FlowEndless need={nearEnd} onSongs={onEndless} />}
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
  return createPortal(layer, document.body);
}
