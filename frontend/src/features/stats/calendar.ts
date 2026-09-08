import type { HistoryEntry } from '@/types';

/**
 * v5.17.0 — Listening calendar: a 12-week, Monday-first heatmap of minutes per
 * day plus current/longest streaks, computed from on-device history. Pure.
 *
 * Cells come back column-major (week by week, Monday→Sunday) so the UI can
 * lay them out with `grid-flow-col grid-rows-7`. Days after "today" in the
 * last column are `future` and render as blanks.
 */
export interface CalendarCell {
  /** Local date key, YYYY-MM-DD. */
  key: string;
  ts: number;
  minutes: number;
  /** 0 = nothing, 1–4 = intensity bucket relative to the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
  today: boolean;
}

export interface CalendarData {
  cells: CalendarCell[];
  weeks: number;
  maxMinutes: number;
  currentStreak: number;
  longestStreak: number;
  /** Days with any listening inside the grid. */
  activeDays: number;
}

const DAY = 86_400_000;

export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function creditedSeconds(e: HistoryEntry): number {
  const dur = e.song?.duration ?? 0;
  return e.completed ? dur : Math.min(dur, Math.max(30, dur / 3));
}

/** Minutes listened per local day, for every entry. */
export function minutesByDay(entries: HistoryEntry[]): Map<string, number> {
  const secs = new Map<string, number>();
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song) continue;
    const k = localDayKey(e.ts);
    secs.set(k, (secs.get(k) ?? 0) + creditedSeconds(e));
  }
  const out = new Map<string, number>();
  for (const [k, s] of secs) out.set(k, Math.round(s / 60));
  return out;
}

/** Current (ending today or yesterday) and longest runs of days with listening. */
export function listeningStreaks(days: Set<string>, now: number): { current: number; longest: number } {
  const today = startOfDay(now);
  let current = 0;
  let cursor = days.has(localDayKey(today)) ? today : today - DAY;
  while (days.has(localDayKey(cursor))) {
    current += 1;
    cursor -= DAY;
  }
  let longest = 0;
  const sorted = [...days].sort();
  let run = 0;
  let prev: number | null = null;
  for (const k of sorted) {
    const [y, m, d] = k.split('-').map(Number);
    const ts = new Date(y, m - 1, d).getTime();
    run = prev !== null && Math.round((ts - prev) / DAY) === 1 ? run + 1 : 1;
    prev = ts;
    if (run > longest) longest = run;
  }
  return { current, longest: Math.max(longest, current) };
}

export function calendarCells(entries: HistoryEntry[], now = Date.now(), weeks = 12): CalendarData {
  const byDay = minutesByDay(entries);
  const today = startOfDay(now);
  const todayKey = localDayKey(today);
  // Monday-first: JS getDay() is 0 = Sunday.
  const dow = (new Date(today).getDay() + 6) % 7;
  const thisMonday = today - dow * DAY;
  const firstMonday = thisMonday - (weeks - 1) * 7 * DAY;

  const cells: CalendarCell[] = [];
  let maxMinutes = 0;
  let activeDays = 0;
  for (let i = 0; i < weeks * 7; i++) {
    // Re-derive from calendar parts so a DST shift never skews a column.
    const base = new Date(firstMonday);
    const ts = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).getTime();
    const key = localDayKey(ts);
    const future = ts > today;
    const minutes = future ? 0 : byDay.get(key) ?? 0;
    if (minutes > 0) activeDays += 1;
    if (minutes > maxMinutes) maxMinutes = minutes;
    cells.push({ key, ts, minutes, level: 0, future, today: key === todayKey });
  }
  for (const c of cells) {
    if (c.minutes <= 0) continue;
    const r = c.minutes / Math.max(1, maxMinutes);
    c.level = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
  }
  const active = new Set<string>();
  for (const [k, m] of byDay) if (m > 0) active.add(k);
  const streaks = listeningStreaks(active, now);
  return { cells, weeks, maxMinutes, currentStreak: streaks.current, longestStreak: streaks.longest, activeDays };
}
