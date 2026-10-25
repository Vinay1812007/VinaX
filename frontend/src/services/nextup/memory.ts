import type { Song } from '@/types';
import type { HistoryEntry } from '@/types';

/**
 * V2 — what Up Next remembers between sessions: the songs it queued on its
 * own, and when. Together with the play history this is the no-repeat
 * ledger: a song the listener heard in the last three days, or one the
 * engine queued yesterday and the listener never reached, is not offered
 * again automatically.
 */

const KEY = 'vinax.nextup.served.v1';
export const SERVED_CAP = 600;
const HORIZON_MS = 7 * 86_400_000;

type Row = [key: string, at: number];

function read(): Row[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((r): r is Row => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'number') : [];
  } catch {
    return [];
  }
}

function write(rows: Row[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(-SERVED_CAP)));
  } catch {
    /* storage full or blocked: the history still guards repeats */
  }
}

/** Remember that these songs were queued automatically. */
export function recordServed(keys: readonly string[], now = Date.now()): void {
  if (!keys.length) return;
  const fresh = new Set(keys);
  const rows = read().filter(([k, t]) => !fresh.has(k) && now - t < HORIZON_MS);
  for (const k of keys) rows.push([k, now]);
  write(rows);
}

/** key → when it was last queued automatically. */
export function servedMap(now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, t] of read()) if (now - t < HORIZON_MS) out.set(k, Math.max(t, out.get(k) ?? 0));
  return out;
}

/** key → when it last started playing: the play ledger, then the play history (newest first). */
export function playedMap(history: readonly HistoryEntry[], keyOf: (s: Song) => string, now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, t] of readPlayed()) if (now - t < PLAYED_HORIZON_MS && (out.get(k) ?? 0) < t) out.set(k, t);
  for (const e of history) {
    if (!e?.song) continue;
    const k = keyOf(e.song);
    if (!out.has(k) || (out.get(k) ?? 0) < e.ts) out.set(k, e.ts);
  }
  return out;
}

const PLAYED_KEY = 'vinax.nextup.played.v1';
export const PLAYED_CAP = 1200;
const PLAYED_HORIZON_MS = 72 * 3_600_000;

function readPlayed(): Row[] {
  try {
    const raw = window.localStorage.getItem(PLAYED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((r): r is Row => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Remember that a song started playing. The play history keeps only its
 * latest 150 entries (skips included), which a heavy listener fills in a day;
 * this ledger holds three days of plays so the 72-hour rule really holds.
 */
export function recordPlayed(key: string, now = Date.now()): void {
  if (!key) return;
  const rows = readPlayed().filter(([k, t]) => k !== key && now - t < PLAYED_HORIZON_MS);
  rows.push([key, now]);
  try {
    window.localStorage.setItem(PLAYED_KEY, JSON.stringify(rows.slice(-PLAYED_CAP)));
  } catch {
    /* the history still covers the latest plays */
  }
}

/** Test hook. */
export function resetServed(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(PLAYED_KEY);
  } catch { /* ignore */ }
}
