import type { Song } from '@/types';

/**
 * 7.2.0 — the playback-session measurement contract.
 *
 * Everything that learns from listening — the taste profile (PLAY, SKIP,
 * COMPLETE), transition memory, the listen clock and usage analytics — reads
 * ONE measurement: the seconds of a playback instance that were actually
 * heard. The playhead position is never used as a proxy for it.
 *
 * Playback instance. A new instance begins every time the player starts a
 * track: a tap, an advance, a restore, and each repeat-one loop. It has an id
 * (`pb-<n>`), the song, and the song it was handed off from (only when the
 * queue moved forward one step). Consecutive instances of one track through
 * repeat-one share a RUN, and a run learns at most one PLAY, one SKIP and one
 * COMPLETE, so looping a song for an hour cannot flood the profile.
 *
 * Heard time. A time update credits `delta = time − lastTime` only when:
 *   - no seek is pending (the player declares its seeks: the listener's own,
 *     resume-from-position, A-B repeat, repeat-one's jump to 0);
 *   - the player is not buffering;
 *   - 0 < delta ≤ allowance, where allowance = max(4 s × rate, wall-clock
 *     seconds since the last tick × rate × 1.25 + 1 s). The wall-clock arm
 *     keeps throttled background ticks (a WebView in the background, a locked
 *     phone) creditable while an undeclared jump — an engine recovery reload,
 *     a scrub the player did not see — is not.
 * Pauses produce no time advance and so no credit. Playback rate counts
 * media seconds: at 2× a 200 s song is fully heard after 100 s of wall time.
 *
 * Verdicts (duration known / unknown):
 *   PLAY      heard ≥ min(5 s, 70 % of the song)        / heard ≥ 5 s
 *   COMPLETE  natural end AND heard ≥ 70 % of the song  / natural end AND heard ≥ 30 s
 *   SKIP      a manual skip with heard < 30 % of the song after the PLAY counted
 *                                                       / … heard < 30 s
 *   early     a manual skip before the PLAY counted: a restless sitting, never a
 *             verdict on the song (session intent only).
 * Failed playback (every source failed) ends the instance with reason
 * `failed`: no SKIP, no transition verdict.
 */
export const COUNTED_PLAY_SEC = 5;
export const COMPLETE_RATIO = 0.7;
export const SKIP_RATIO = 0.3;
/** Unknown duration: the completion and early-leave line in seconds. */
export const UNKNOWN_DURATION_SEC = 30;
const MAX_TICK_SEC = 4;
/** Ticks allowed for a declared seek to land before measuring resumes anyway. */
const SEEK_SETTLE_TICKS = 3;

export type PlaybackEndReason = 'ended' | 'manual-skip' | 'advance' | 'replaced' | 'failed' | 'repeat' | 'cleared';

export interface PlaybackRun {
  readonly id: string;
  played: boolean;
  completed: boolean;
  skipped: boolean;
}

export interface PlaybackInstance {
  readonly id: string;
  readonly song: Song;
  readonly run: PlaybackRun;
  /** The song this one was handed off from, when the queue moved forward one step. */
  readonly from: Song | null;
  readonly startedAt: number;
  heardSec: number;
  durationSec: number;
  failed: boolean;
  endReason: PlaybackEndReason | null;
  finalized: boolean;
  lastTime: number;
  lastWall: number;
  seekTarget: number | null;
  seekTicks: number;
}

let seq = 0;
const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

export function newRun(): PlaybackRun {
  return { id: newId('run'), played: false, completed: false, skipped: false };
}

export function newPlaybackInstance(song: Song, opts: { from?: Song | null; run?: PlaybackRun; startAt?: number; now?: number } = {}): PlaybackInstance {
  const now = opts.now ?? Date.now();
  return {
    id: newId('pb'),
    song,
    run: opts.run ?? newRun(),
    from: opts.from ?? null,
    startedAt: now,
    heardSec: 0,
    durationSec: song.duration && song.duration > 0 ? song.duration : 0,
    failed: false,
    endReason: null,
    finalized: false,
    lastTime: opts.startAt ?? 0,
    lastWall: now,
    seekTarget: null,
    seekTicks: 0,
  };
}

/** The player moved the playhead on purpose: measuring re-bases on the new position. */
export function noteSeek(inst: PlaybackInstance, target: number): void {
  inst.seekTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
  inst.seekTicks = 0;
}

/** Fold one time update into the instance. Returns the seconds credited as heard. */
export function creditTick(inst: PlaybackInstance, time: number, duration: number, env: { rate?: number; buffering?: boolean; now?: number } = {}): number {
  const now = env.now ?? Date.now();
  const rate = env.rate && env.rate > 0 ? env.rate : 1;
  if (duration > 0 && Number.isFinite(duration)) inst.durationSec = duration;
  const wall = Math.max(0, (now - inst.lastWall) / 1000);
  const prevTime = inst.lastTime;
  inst.lastTime = time;
  inst.lastWall = now;
  if (inst.finalized || !Number.isFinite(time)) return 0;
  if (inst.seekTarget !== null) {
    // Wait for the jump to land (a tick from before the seek may still arrive).
    inst.seekTicks += 1;
    if (Math.abs(time - inst.seekTarget) <= 2 || inst.seekTicks >= SEEK_SETTLE_TICKS) inst.seekTarget = null;
    return 0;
  }
  if (env.buffering) return 0;
  const delta = time - prevTime;
  const allowance = Math.max(MAX_TICK_SEC * rate, wall * rate * 1.25 + 1);
  if (!(delta > 0) || delta > allowance) return 0;
  inst.heardSec += delta;
  return delta;
}

/** Heard seconds at which a play counts toward taste. */
export function playThreshold(durationSec: number): number {
  return durationSec > 0 ? Math.min(COUNTED_PLAY_SEC, COMPLETE_RATIO * durationSec) : COUNTED_PLAY_SEC;
}

export function isCompletion(heardSec: number, durationSec: number): boolean {
  return durationSec > 0 ? heardSec >= COMPLETE_RATIO * durationSec - 0.5 : heardSec >= UNKNOWN_DURATION_SEC;
}

/** Left early enough that leaving by hand reads as "not for me". */
export function isEarlyLeave(heardSec: number, durationSec: number): boolean {
  return durationSec > 0 ? heardSec < SKIP_RATIO * durationSec : heardSec < UNKNOWN_DURATION_SEC;
}

/** Transition-memory verdict for an ended instance: by heard time, never by position; failures judge nothing. */
export function transitionOutcome(heardSec: number, durationSec: number, reason: PlaybackEndReason | null): 'completed' | 'skipped' | null {
  if (reason === 'failed' || !(durationSec > 0)) return null;
  const ratio = heardSec / durationSec;
  if (ratio >= COMPLETE_RATIO) return 'completed';
  if (ratio < SKIP_RATIO) return 'skipped';
  return null;
}

/* ---- events: the one place other modules learn how a play went ---- */

/** How an automatic queue entry got there (null for the listener's own songs). */
export interface AutoEntryMeta {
  alg: string;
  picker: 'local' | 'ai' | 'reserve';
  /** 0-based position inside its continuation. */
  pos: number;
  batch: number;
}

export type PlaybackEvent =
  | { kind: 'credit'; instanceId: string; songId: string; seconds: number }
  /** The run's PLAY was just counted (enough of it heard): the one moment a play is a play, for taste and for usage analytics alike. */
  | { kind: 'counted'; instanceId: string; song: Song; heardSec: number }
  | { kind: 'end'; instanceId: string; song: Song; from: Song | null; heardSec: number; durationSec: number; reason: PlaybackEndReason; run: Readonly<PlaybackRun>; auto: AutoEntryMeta | null }
  /** An automatic continuation entered the queue (after the admission gate). */
  | { kind: 'served'; batch: number; alg: string; picker: 'local' | 'ai' | 'reserve'; fallback: string | null; latencyMs: number; n: number; discovery: number; languageViolations: number; relaxed: string[]; refinementPending: boolean }
  /** The AI refinement of a continuation settled: applied, or the reason it was not. */
  | { kind: 'refined'; batch: number; applied: boolean; fallback: string | null; latencyMs: number; n: number };

type Listener = (e: PlaybackEvent) => void;
const listeners = new Set<Listener>();

export function onPlaybackEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitPlaybackEvent(e: PlaybackEvent): void {
  for (const cb of [...listeners]) {
    try {
      cb(e);
    } catch {
      /* a listener's failure never reaches playback */
    }
  }
}
