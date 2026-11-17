import type { HistoryEntry, Song } from '@/types';
import type { StoredEvent } from '@/services/storage/idb';
import { HISTORY_CAP } from './listening';
import { isForgotten, PLAY_MATCH_AFTER_MS, type ForgottenRange } from './forgotten';

/**
 * Your VinaX reads two records of listening and counts each play once:
 *
 *   history  — the last 150 plays, synced between signed-in devices, with
 *              artwork and measured listening time (store/historyStore).
 *   play log — this device's IndexedDB event log (services/storage/idb), up
 *              to 5000 rows of every kind; only its `play` rows count here.
 *
 * History is the authority for the stretch it covers. A log play that matches
 * a History entry (same song, logged between PLAY_MATCH_BEFORE_MS before and
 * PLAY_MATCH_AFTER_MS after the entry; History stamps a play when it starts,
 * the log once ~5 s are heard) is the same play. A log play that matches
 * nothing inside History's stretch was removed by the listener, so it is
 * dropped. Log plays OLDER than History's oldest entry fill in what the
 * 150-play cap cut off — but only while History is (nearly) full: a short
 * History with older log rows means the listener cleared it. Plays the
 * listener cleared are skipped through ./forgotten (staleClearNote covers
 * clears that left no note).
 *
 * Pure, so it is unit-tested (playLog.test.ts).
 */
export const LOG_LIMIT = 5000;
/** A log row can sit a little before its History entry (clock rounding, restore paths). */
export const PLAY_MATCH_BEFORE_MS = 5_000;
/** History counts as full a few plays short of its cap, so one removed play does not hide the log. */
const NEAR_CAP = HISTORY_CAP - 10;
/** A complete/skip row belongs to the play before it only within this long. */
const OUTCOME_WINDOW_MS = 6 * 60 * 60_000;

export interface MergedPlays {
  /** Every counted play, newest first. */
  entries: HistoryEntry[];
  /** History holds (nearly) its maximum, so older synced plays were dropped. */
  historyCapped: boolean;
  /** Oldest History entry. */
  historyOldestTs: number | null;
  /** Oldest row the read log holds (any kind), or null when it is empty. */
  logOldestTs: number | null;
  /** The read hit LOG_LIMIT rows, so the log itself may have lost older rows. */
  logFull: boolean;
  /** Plays that came from the log alone. */
  fromLog: number;
}

/** A song for a log-only play: the stored record when this device has one, else the log's own fields. */
function songFor(e: StoredEvent, known: ReadonlyMap<string, Song>): Song {
  const hit = known.get(e.songId);
  if (hit) return hit;
  const names = (e.artistNames ?? []).filter((n) => typeof n === 'string' && n.trim());
  return {
    kind: 'song',
    id: e.songId,
    title: e.title || 'Unknown song',
    subtitle: names.join(', '),
    artists: names.map((name) => ({ id: '', name })),
    album: null,
    images: [],
    audio: [],
    duration: typeof e.songDuration === 'number' && e.songDuration > 0 ? e.songDuration : null,
    language: e.language ?? null,
    year: null,
    explicit: false,
    hasLyrics: false,
    playCount: null,
  };
}

/** The log's play rows as History-shaped entries, with completion and heard time from the row that ended them. */
export function logPlays(events: readonly StoredEvent[], known: ReadonlyMap<string, Song> = new Map()): HistoryEntry[] {
  const sorted = events.filter((e) => e && typeof e.ts === 'number' && Number.isFinite(e.ts) && typeof e.songId === 'string' && e.songId).slice().sort((a, b) => a.ts - b.ts);
  const out: HistoryEntry[] = [];
  /** songId → index in `out` of that song's latest play still waiting for its outcome. */
  const open = new Map<string, number>();
  for (const e of sorted) {
    if (e.type === 'play') {
      out.push({ song: songFor(e, known), ts: e.ts, completed: false });
      open.set(e.songId, out.length - 1);
      continue;
    }
    if (e.type !== 'complete' && e.type !== 'skip') continue;
    const idx = open.get(e.songId);
    if (idx === undefined) continue;
    const play = out[idx];
    if (e.ts - play.ts > OUTCOME_WINDOW_MS) continue;
    open.delete(e.songId);
    const next: HistoryEntry = { ...play, completed: e.type === 'complete' };
    if (e.type === 'skip') next.skipped = true;
    if (typeof e.playedSec === 'number' && Number.isFinite(e.playedSec) && e.playedSec >= 0) next.listenedSec = e.playedSec;
    out[idx] = next;
  }
  return out;
}

/**
 * Pair each log play with at most one History entry of the same song (the
 * nearest one in the match window) and return the log plays left over.
 */
function unmatched(history: readonly HistoryEntry[], plays: readonly HistoryEntry[]): HistoryEntry[] {
  const bySong = new Map<string, number[]>();
  for (const h of history) {
    if (!h?.song?.id || typeof h.ts !== 'number') continue;
    const list = bySong.get(h.song.id) ?? [];
    list.push(h.ts);
    bySong.set(h.song.id, list);
  }
  const used = new Set<string>();
  const left: HistoryEntry[] = [];
  for (const p of plays) {
    const candidates = bySong.get(p.song.id) ?? [];
    let best: number | null = null;
    for (const ts of candidates) {
      const lag = p.ts - ts;
      if (lag < -PLAY_MATCH_BEFORE_MS || lag > PLAY_MATCH_AFTER_MS) continue;
      if (used.has(`${p.song.id}|${ts}`)) continue;
      if (best === null || Math.abs(lag) < Math.abs(p.ts - best)) best = ts;
    }
    if (best === null) left.push(p);
    else used.add(`${p.song.id}|${best}`);
  }
  return left;
}

export function mergePlays(
  history: readonly HistoryEntry[],
  events: readonly StoredEvent[],
  opts: { known?: ReadonlyMap<string, Song>; forgotten?: readonly ForgottenRange[]; limit?: number } = {},
): MergedPlays {
  const valid = history.filter((h) => h?.song?.id && typeof h.ts === 'number');
  let historyOldestTs: number | null = null;
  for (const h of valid) if (historyOldestTs === null || h.ts < historyOldestTs) historyOldestTs = h.ts;
  const historyCapped = valid.length >= NEAR_CAP;
  let logOldestTs: number | null = null;
  for (const e of events) if (typeof e?.ts === 'number' && (logOldestTs === null || e.ts < logOldestTs)) logOldestTs = e.ts;

  const forgotten = opts.forgotten ?? [];
  const extra = unmatched(valid, logPlays(events, opts.known)).filter(
    (p) =>
      historyCapped &&
      historyOldestTs !== null &&
      p.ts < historyOldestTs - PLAY_MATCH_BEFORE_MS &&
      !isForgotten(forgotten, p.song.id, p.ts),
  );
  const entries = [...valid, ...extra].sort((a, b) => b.ts - a.ts);
  return {
    entries,
    historyCapped,
    historyOldestTs,
    logOldestTs,
    logFull: events.length >= (opts.limit ?? LOG_LIMIT),
    fromLog: extra.length,
  };
}

/**
 * A note for a clear that left none (made before ./forgotten existed). History
 * records every play before the log does, so while History is short, log
 * plays older than its oldest entry are plays the listener cleared or removed.
 * They are hidden today because History is short; this note keeps them hidden
 * once History fills up again. Null when there is nothing to note.
 */
export function staleClearNote(
  history: readonly HistoryEntry[],
  events: readonly StoredEvent[],
  forgotten: readonly ForgottenRange[] = [],
): ForgottenRange | null {
  const valid = history.filter((h) => h?.song?.id && typeof h.ts === 'number');
  if (valid.length >= NEAR_CAP) return null;
  let cutoff = Infinity;
  for (const h of valid) cutoff = Math.min(cutoff, h.ts - PLAY_MATCH_BEFORE_MS);
  let to: number | null = null;
  for (const e of events) {
    if (e?.type !== 'play' || typeof e.ts !== 'number' || !Number.isFinite(e.ts) || e.ts >= cutoff) continue;
    if (isForgotten(forgotten, e.songId, e.ts)) continue;
    if (to === null || e.ts > to) to = e.ts;
  }
  return to === null ? null : { from: 0, to };
}

export type StatsRange = '4w' | '6m' | 'all';
export const STATS_RANGES: ReadonlyArray<{ id: StatsRange; label: string; window: string }> = [
  { id: '4w', label: '4 weeks', window: 'the last 4 weeks' },
  { id: '6m', label: '6 months', window: 'the last 6 months' },
  { id: 'all', label: 'All time', window: 'all time' },
];

/** Where a range starts: 28 days back, six calendar months back, or the beginning. */
export function rangeStart(range: StatsRange, now = Date.now()): number {
  if (range === '4w') return now - 28 * 86_400_000;
  if (range === '6m') {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() - 6, d.getDate(), d.getHours(), d.getMinutes()).getTime();
  }
  return -Infinity;
}

export function inRange(entries: readonly HistoryEntry[], range: StatsRange, now = Date.now()): HistoryEntry[] {
  const from = rangeStart(range, now);
  return entries.filter((e) => e.ts >= from);
}

export interface MergedCoverage {
  /** Every play this device knows of reaches back to the window's start. */
  complete: boolean;
  /** How far back the counted plays reach, when they fall short. */
  since: number | null;
  /** Before this time only this device's own plays count (synced plays from other devices were cut). */
  deviceOnlyBefore: number | null;
}

/**
 * Does the merged record reach back to `from`? History that never filled up
 * holds every play, so it is complete. Once full, what reaches further back
 * is this device's log: complete when the log starts before `from` (and was
 * not itself cut by its row limit), otherwise it only counts since its start.
 */
export function mergedCoverage(m: MergedPlays, from: number): MergedCoverage {
  if (!m.historyCapped || m.historyOldestTs === null) return { complete: true, since: null, deviceOnlyBefore: null };
  const deviceOnlyBefore = m.historyOldestTs > from ? m.historyOldestTs : null;
  const oldestPlay = m.entries.length ? m.entries[m.entries.length - 1].ts : m.historyOldestTs;
  // An unfilled log holds everything since it started; a full one only reaches its oldest play.
  const reach = m.logFull || m.logOldestTs === null ? oldestPlay : Math.min(oldestPlay, m.logOldestTs);
  if (reach <= from) return { complete: true, since: null, deviceOnlyBefore };
  return { complete: false, since: oldestPlay, deviceOnlyBefore };
}

const shortDate = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One plain line for a window the record does not fully cover, or null. `synced` adds the other-devices caveat. */
export function mergedCoverageNote(cov: MergedCoverage, windowLabel: string, synced = false): string | null {
  if (!cov.complete && cov.since !== null) return `Your plays on record go back to ${shortDate(cov.since)}, so ${windowLabel} only counts listening since then.`;
  if (synced && cov.deviceOnlyBefore !== null) return `Before ${shortDate(cov.deviceOnlyBefore)}, ${windowLabel} counts plays from this device only.`;
  return null;
}
