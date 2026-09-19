import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { onPlaybackEvent } from '@/services/playback/session';

/**
 * Measured listening time. Credits each history entry with the seconds that
 * ACTUALLY played.
 *
 * 7.2.0 — the clock no longer measures on its own: it banks the seconds the
 * player's playback instance credits (services/playback/session.ts), so the
 * listen clock, the taste profile, transition memory and analytics all read
 * one measurement. Pauses, seeks, buffering and undeclared jumps add nothing;
 * each repeat-one loop keeps adding to the same history entry; plays recorded
 * before measurement existed keep no `listenedSec` and are estimated by
 * features/stats/listening.ts — nothing is invented.
 *
 * Seconds are batched in memory and flushed to the history store every
 * FLUSH_MS, when a playback instance ends and when the page is hidden, so the
 * persisted history is not rewritten four times a second.
 */
/** Largest step a lone snapshot comparison credits (kept for `tickCredit`; matches the session's tick allowance). */
const MAX_TICK_SEC = 4;
const FLUSH_MS = 30_000;

interface Snapshot {
  songId: string | null;
  time: number;
  playing: boolean;
}

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
  const unsubscribe = onPlaybackEvent((e) => {
    if (e.kind === 'credit') credit(e.songId, e.seconds);
    // A play ended: bank what we have so a crash loses at most FLUSH_MS.
    else if (e.kind === 'end') flush();
  });
  // A pause banks too.
  const unsubscribePause = usePlayerStore.subscribe((s, prev) => {
    if (prev.isPlaying && !s.isPlaying) flush();
  });
  const onHide = (): void => {
    if (document.hidden) flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  stop = () => {
    unsubscribe();
    unsubscribePause();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    flush();
    stop = null;
  };
  return stop;
}

/** Test hook: bank pending seconds now. */
export const flushListenClock = flush;
