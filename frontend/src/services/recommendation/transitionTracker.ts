import { onPlaybackEvent, transitionOutcome } from '@/services/playback/session';
import { recordTransition, type TransitionOutcome } from './transitions';

/**
 * v6.3.0 — feeds transition memory from real playback. When a song B ends,
 * its hand-off A → B is judged: ≥ 70 % HEARD = completed, < 30 % heard =
 * skipped, in between = no verdict. A hand-off exists only when the queue
 * moved forward one step (next / autoplay); a song the listener jumped to by
 * hand from elsewhere has none.
 *
 * 7.2.0 — the verdict reads the playback instance's heard seconds (see
 * services/playback/session.ts), not the furthest playhead position: seeking
 * to the last seconds used to count as "completed". Failed playback judges
 * nothing.
 */

/** Pure verdict for a play that just ended (heard seconds against duration). */
export function outcomeFor(heardSec: number, durationSec: number): TransitionOutcome | null {
  return transitionOutcome(heardSec, durationSec, null);
}

let stop: (() => void) | null = null;

export function initTransitionTracker(): () => void {
  if (stop) return stop;
  const unsubscribe = onPlaybackEvent((e) => {
    if (e.kind !== 'end' || !e.from) return;
    const verdict = transitionOutcome(e.heardSec, e.durationSec, e.reason);
    if (verdict) recordTransition(e.from, e.song, verdict);
  });
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}
