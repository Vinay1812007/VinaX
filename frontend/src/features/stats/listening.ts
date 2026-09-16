import type { HistoryEntry } from '@/types';

/**
 * ONE listening-time rule for Home, Stats, the weekly report, the calendar,
 * the daily goal ring and the AI daily brief.
 *
 * Before this module each surface did its own maths: Home and Stats summed
 * full track lengths (with Home defaulting unknown lengths to 180 s), while
 * the weekly report and calendar credited a third of an unfinished track.
 * The same week showed different minutes on different screens.
 *
 *   measured  — the player clocked real playback for that entry
 *               (`listenedSec`, see services/analytics/listenClock.ts).
 *   estimated — older entries: a completed play counts the full track; an
 *               unfinished one a third of it (30 s floor); an unknown length
 *               counts 180 s when completed and 45 s otherwise.
 *
 * Every total says whether it is exact or an estimate, and every window
 * says whether the 150-play history cap cut it short.
 */
export const HISTORY_CAP = 150;
const UNKNOWN_COMPLETED_SEC = 180;
const UNKNOWN_PARTIAL_SEC = 45;
/** No single play may claim more than this (guards corrupt entries). */
const MAX_PLAY_SEC = 6 * 60 * 60;

export interface CreditedPlay {
  seconds: number;
  measured: boolean;
}

export function creditedSeconds(e: HistoryEntry): CreditedPlay {
  const measured = typeof e.listenedSec === 'number' && Number.isFinite(e.listenedSec) && e.listenedSec >= 0;
  if (measured) return { seconds: Math.min(MAX_PLAY_SEC, e.listenedSec as number), measured: true };
  const dur = typeof e.song?.duration === 'number' && e.song.duration > 0 ? e.song.duration : null;
  if (dur === null) return { seconds: e.completed ? UNKNOWN_COMPLETED_SEC : UNKNOWN_PARTIAL_SEC, measured: false };
  return { seconds: e.completed ? dur : Math.min(dur, Math.max(30, dur / 3)), measured: false };
}

export interface ListeningTotal {
  seconds: number;
  minutes: number;
  plays: number;
  /** Plays that carried a measured duration. */
  measuredPlays: number;
  /** True when any play in the total was estimated rather than measured. */
  estimated: boolean;
}

/** Total listening for entries with `from <= ts < to` (defaults: everything). */
export function listeningTotal(entries: readonly HistoryEntry[], from = -Infinity, to = Infinity): ListeningTotal {
  let seconds = 0;
  let plays = 0;
  let measuredPlays = 0;
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song) continue;
    if (e.ts < from || e.ts >= to) continue;
    const c = creditedSeconds(e);
    seconds += c.seconds;
    plays += 1;
    if (c.measured) measuredPlays += 1;
  }
  return { seconds, minutes: Math.round(seconds / 60), plays, measuredPlays, estimated: plays > measuredPlays };
}

/** "≈ 42 min" for estimates, "42 min" when every play was measured. */
export function formatMinutes(total: Pick<ListeningTotal, 'minutes' | 'estimated'>): string {
  return `${total.estimated ? '≈ ' : ''}${total.minutes} min`;
}

export function formatHours(total: Pick<ListeningTotal, 'seconds' | 'estimated'>): string {
  const h = total.seconds / 3600;
  const n = h >= 10 ? String(Math.round(h)) : h.toFixed(1);
  return `${total.estimated ? '≈ ' : ''}${n}h`;
}

export interface HistoryCoverage {
  /** History holds its maximum number of plays, so older plays were dropped. */
  capped: boolean;
  /** Oldest play still on record. */
  oldestTs: number | null;
  /** True when the window `from` is fully inside the retained history. */
  complete: boolean;
}

/**
 * Does the retained history cover a window starting at `from`? With the
 * 150-play cap a heavy listener's "last 7 days" or "12 weeks" can start
 * later than it claims; surfaces must say so instead of showing a low
 * number as fact.
 */
export function historyCoverage(entries: readonly HistoryEntry[], from: number, cap = HISTORY_CAP): HistoryCoverage {
  let oldestTs: number | null = null;
  let n = 0;
  for (const e of entries) {
    if (typeof e?.ts !== 'number') continue;
    n += 1;
    if (oldestTs === null || e.ts < oldestTs) oldestTs = e.ts;
  }
  const capped = n >= cap;
  const complete = !capped || (oldestTs !== null && oldestTs <= from);
  return { capped, oldestTs, complete };
}

/** A one-line caveat for an incomplete window, or null when the window is complete. */
export function coverageNote(cov: HistoryCoverage, windowLabel: string, cap = HISTORY_CAP): string | null {
  if (cov.complete || cov.oldestTs === null) return null;
  const since = new Date(cov.oldestTs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `History keeps your last ${cap} plays, so ${windowLabel} only counts listening since ${since}.`;
}
