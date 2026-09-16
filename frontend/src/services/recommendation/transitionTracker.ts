import { usePlayerStore } from '@/store/playerStore';
import { recordTransition, type TransitionOutcome } from './transitions';
import type { Song } from '@/types';

/**
 * v6.3.0 — feeds transition memory from real playback. Watches the player:
 * when the song changes from B to C, it judges how B went (≥ 70 % played =
 * completed, < 30 % = skipped, in between = no verdict) and records that
 * against the hand-off A → B. Nothing is recorded for a song the listener
 * jumped to by hand from far away (the pair is not a hand-off then).
 */
interface Current {
  song: Song;
  from: Song | null;
  lastTime: number;
  duration: number;
}

let cur: Current | null = null;
let stop: (() => void) | null = null;

/** Pure verdict for a play that just ended. */
export function outcomeFor(playedSec: number, durationSec: number): TransitionOutcome | null {
  if (!(durationSec > 0)) return null;
  const ratio = playedSec / durationSec;
  if (ratio >= 0.7) return 'completed';
  if (ratio < 0.3) return 'skipped';
  return null;
}

export function initTransitionTracker(): () => void {
  if (stop) return stop;
  const unsubscribe = usePlayerStore.subscribe((s, prev) => {
    const song = s.queue[s.index] ?? null;
    if (!song) return;
    if (!cur || cur.song.id !== song.id) {
      if (cur && cur.from) {
        const verdict = outcomeFor(cur.lastTime, cur.duration);
        if (verdict) recordTransition(cur.from, cur.song, verdict);
      }
      // A hand-off is "the song that played right before"; only count it when
      // the queue actually moved forward one step (next / autoplay), not on a
      // jump elsewhere in the queue.
      const forward = prev.queue[prev.index]?.id === cur?.song.id && s.index === prev.index + 1;
      cur = { song, from: forward && cur ? cur.song : null, lastTime: 0, duration: s.duration };
      return;
    }
    if (s.isPlaying || s.currentTime > cur.lastTime) cur.lastTime = Math.max(cur.lastTime, s.currentTime);
    if (s.duration > 0) cur.duration = s.duration;
  });
  stop = () => {
    unsubscribe();
    cur = null;
    stop = null;
  };
  return stop;
}
