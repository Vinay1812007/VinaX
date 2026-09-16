import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';

/**
 * Measured listening time. Watches the player's clock and credits the
 * current history entry with the seconds that ACTUALLY played:
 *
 *  - pauses add nothing (no ticks arrive while paused);
 *  - a seek is a jump: any step backwards, or forwards by more than a normal
 *    tick, is ignored rather than credited;
 *  - a replay (repeat-one, "play again") keeps adding to the same play, so
 *    a song looped three times counts three times;
 *  - plays recorded before this clock existed keep no `listenedSec` and are
 *    estimated by features/stats/listening.ts — nothing is invented.
 *
 * Seconds are batched in memory and flushed to the history store every
 * FLUSH_MS, on pause, on song change and when the page is hidden, so the
 * persisted history is not rewritten four times a second.
 */
const MAX_TICK_SEC = 3;
const FLUSH_MS = 30_000;

interface Snapshot {
  songId: string | null;
  time: number;
  playing: boolean;
}

let last: Snapshot = { songId: null, time: 0, playing: false };
let pendingSongId: string | null = null;
let pendingSec = 0;
let flushTimer: number | null = null;
let stop: (() => void) | null = null;

function flush(): void {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingSongId && pendingSec > 0) useHistoryStore.getState().addListened(pendingSongId, pendingSec);
  pendingSongId = null;
  pendingSec = 0;
}

function credit(songId: string, seconds: number): void {
  if (pendingSongId && pendingSongId !== songId) flush();
  pendingSongId = songId;
  pendingSec += seconds;
  if (flushTimer == null) flushTimer = window.setTimeout(flush, FLUSH_MS);
}

/** Pure step: what to credit given the previous and next player snapshots. */
export function tickCredit(prev: Snapshot, next: Snapshot): number {
  if (!next.songId || next.songId !== prev.songId) return 0;
  if (!prev.playing || !next.playing) return 0;
  const delta = next.time - prev.time;
  if (delta <= 0 || delta > MAX_TICK_SEC) return 0; // seek, stall or replay wrap
  return delta;
}

export function initListenClock(): () => void {
  if (stop) return stop;
  const unsubscribe = usePlayerStore.subscribe((s) => {
    const song = s.queue[s.index] ?? null;
    const next: Snapshot = { songId: song?.id ?? null, time: s.currentTime, playing: s.isPlaying };
    const add = tickCredit(last, next);
    if (add > 0 && next.songId) credit(next.songId, add);
    // Pause or song change: bank what we have so a crash loses at most 30 s.
    if ((last.playing && !next.playing) || (last.songId && last.songId !== next.songId)) flush();
    last = next;
  });
  const onHide = (): void => {
    if (document.hidden) flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  stop = () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    flush();
    last = { songId: null, time: 0, playing: false };
    stop = null;
  };
  return stop;
}

/** Test hook: bank pending seconds now. */
export const flushListenClock = flush;
