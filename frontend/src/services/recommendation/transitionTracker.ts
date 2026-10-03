import { isCompletion, isEarlyLeave, onPlaybackEvent, playThreshold, transitionOutcome, type PlaybackEndReason } from '@/services/playback/session';
import { useLibraryStore } from '@/store/libraryStore';
import { recordTransition, type TransitionOutcome } from './transitions';
import { recordAutoOutcome, type AutoOutcome } from './recMemory';
import { recordExposure } from './exposure';

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
 *
 * 8.2.0 — the same subscription feeds the engine's memory of its own
 * automatic picks (see `autoOutcomeFor`).
 *
 * 9.1.0 — and the shared exposure ledger (./exposure.ts), which every surface
 * reads. Three distinct events, kept distinct on purpose:
 *
 *   played     the run's play was COUNTED (the 'counted' event: enough of the
 *              song heard). A song the listener opened and left after two
 *              seconds, a cancelled request and a prefetched song nobody saw
 *              are not plays and never land here.
 *   completed  it ran to the end (the completion ratio).
 *   skipped    the listener left early by hand.
 *
 * Automatic and hand-picked plays both count: the ledger is about what the
 * listener has recently MET, and hearing a song is hearing it however it got
 * there. (Whether the ENGINE chose it is the separate question ./recMemory
 * answers.) Failed playback judges nothing.
 */

/** Pure verdict for a play that just ended (heard seconds against duration). */
export function outcomeFor(heardSec: number, durationSec: number): TransitionOutcome | null {
  return transitionOutcome(heardSec, durationSec, null);
}

/**
 * 8.2.0 — how an AUTOMATICALLY queued song went, for the engine's memory of
 * its own picks (./recMemory.ts): a natural end with the song finished, or a
 * like, is a success; a skip by hand before the play counted or inside its
 * first 30 % is a miss; anything else (a partial listen, a tap elsewhere, a
 * cleared queue, failed playback) says nothing. The thresholds are the
 * playback session's own.
 */
export function autoOutcomeFor(heardSec: number, durationSec: number, reason: PlaybackEndReason, liked: boolean): AutoOutcome | null {
  if (reason === 'failed') return null;
  if (liked) return 'success';
  if ((reason === 'ended' || reason === 'repeat') && isCompletion(heardSec, durationSec)) return 'success';
  if (reason === 'manual-skip' && (heardSec < playThreshold(durationSec) || isEarlyLeave(heardSec, durationSec))) return 'miss';
  return null;
}

let stop: (() => void) | null = null;
const judgedRuns = new Set<string>();

export function initTransitionTracker(): () => void {
  if (stop) return stop;
  const unsubscribe = onPlaybackEvent((e) => {
    // 9.1.0 — a counted play is the one moment a play is a play.
    if (e.kind === 'counted') {
      recordExposure([e.song], 'played');
      return;
    }
    if (e.kind !== 'end') return;
    if (e.reason !== 'failed') {
      if (isCompletion(e.heardSec, e.durationSec)) recordExposure([e.song], 'completed');
      else if (e.reason === 'manual-skip' && (e.heardSec < playThreshold(e.durationSec) || isEarlyLeave(e.heardSec, e.durationSec))) {
        recordExposure([e.song], 'skipped');
      }
    }
    // One verdict per run: a repeat-one loop of an automatic song counts once.
    if (e.auto && !judgedRuns.has(e.run.id)) {
      const outcome = autoOutcomeFor(e.heardSec, e.durationSec, e.reason, useLibraryStore.getState().isFavorite(e.song.id));
      if (outcome) {
        judgedRuns.add(e.run.id);
        if (judgedRuns.size > 200) judgedRuns.delete(judgedRuns.values().next().value as string);
        recordAutoOutcome(e.song, outcome);
      }
    }
    if (!e.from) return;
    const verdict = transitionOutcome(e.heardSec, e.durationSec, e.reason);
    if (verdict) recordTransition(e.from, e.song, verdict);
  });
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}
