import { STORAGE_PREFIX } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';

/**
 * Plays the listener took out of History. Your VinaX also reads this device's
 * play log (services/storage/idb), which History's clears do not touch, so
 * each clear leaves a note here and the stats skip log plays inside it.
 *
 *   clear all      → { from: 0, to: now }
 *   clear since X  → { from: X, to: now }
 *   remove one     → { from: ts, to: ts + PLAY_MATCH_AFTER_MS, songId }
 *
 * Device-local, like the log it filters. Kept short: a new note replaces the
 * earlier notes it covers, and only the newest MAX_RANGES are kept.
 */
export const FORGOTTEN_KEY = `${STORAGE_PREFIX}.stats.forgotten.v1`;
const MAX_RANGES = 100;

/** How long after a History entry its play-log row can land (the player logs a play once ~5 s are heard). */
export const PLAY_MATCH_AFTER_MS = 30 * 60_000;

export interface ForgottenRange {
  from: number;
  to: number;
  /** Only this song, when set (a single removed play). */
  songId?: string;
}

const valid = (r: unknown): r is ForgottenRange =>
  !!r && typeof r === 'object' && Number.isFinite((r as ForgottenRange).from) && Number.isFinite((r as ForgottenRange).to);

export function readForgotten(): ForgottenRange[] {
  const raw = getLocal<unknown>(FORGOTTEN_KEY, []);
  return Array.isArray(raw) ? raw.filter(valid) : [];
}

function write(ranges: ForgottenRange[]): void {
  setLocal(FORGOTTEN_KEY, ranges.slice(-MAX_RANGES));
}

/** Remember a cleared stretch. Returns what was stored before, for Undo. */
export function forgetPlays(range: ForgottenRange): ForgottenRange[] {
  const before = readForgotten();
  // A note inside the new one adds nothing (a clear-all covers every earlier clear).
  const covered = (r: ForgottenRange): boolean =>
    r.from >= range.from && r.to <= range.to && (!range.songId || r.songId === range.songId);
  write([...before.filter((r) => !covered(r)), range]);
  return before;
}

/** Put back what `forgetPlays` returned (History's Undo). */
export function restoreForgotten(ranges: ForgottenRange[]): void {
  write(ranges);
}

export function isForgotten(ranges: readonly ForgottenRange[], songId: string, ts: number): boolean {
  return ranges.some((r) => ts >= r.from && ts <= r.to && (!r.songId || r.songId === songId));
}
