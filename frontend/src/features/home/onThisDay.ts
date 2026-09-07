import type { HistoryEntry, Song } from '@/types';

/**
 * v5.12.0 — "On this day": what you were playing on this date in earlier
 * months and years, from the on-device history. Pure, so it is unit-tested.
 *
 * Match order: same day-of-month in any earlier month (nearest first), then a
 * one-day tolerance so a 31st still finds something in a 30-day month. Songs
 * are deduped, newest listen first, and the current day is never included.
 */
export interface OnThisDayResult {
  songs: Song[];
  /** Human label for the shelf ("3 months ago", "Last year"). */
  label: string;
}

const DAY = 86_400_000;

export function onThisDay(entries: HistoryEntry[], now = Date.now(), min = 4, max = 12): OnThisDayResult | null {
  if (!entries.length) return null;
  const today = new Date(now);
  const dom = today.getDate();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), dom).getTime();

  const byMonthsAgo = new Map<number, HistoryEntry[]>();
  for (const e of entries) {
    if (!e?.song?.id || typeof e.ts !== 'number') continue;
    if (e.ts >= startOfToday - DAY) continue; // today / yesterday are not memories
    const d = new Date(e.ts);
    const monthsAgo = (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
    if (monthsAgo <= 0) continue;
    if (Math.abs(d.getDate() - dom) > 1) continue;
    const list = byMonthsAgo.get(monthsAgo) ?? [];
    list.push(e);
    byMonthsAgo.set(monthsAgo, list);
  }
  if (!byMonthsAgo.size) return null;

  // Nearest anniversary first; pull from older ones until the shelf is full.
  const ordered = [...byMonthsAgo.keys()].sort((a, b) => a - b);
  const seen = new Set<string>();
  const songs: Song[] = [];
  let firstMonths = 0;
  for (const m of ordered) {
    const list = (byMonthsAgo.get(m) ?? []).sort((a, b) => b.ts - a.ts);
    for (const e of list) {
      if (seen.has(e.song.id)) continue;
      seen.add(e.song.id);
      songs.push(e.song);
      if (!firstMonths) firstMonths = m;
      if (songs.length >= max) break;
    }
    if (songs.length >= max) break;
  }
  if (songs.length < min) return null;
  const label = firstMonths >= 12 ? (firstMonths >= 24 ? `${Math.floor(firstMonths / 12)} years ago` : 'Last year') : firstMonths === 1 ? 'Last month' : `${firstMonths} months ago`;
  return { songs, label };
}

/** Minutes listened today, from history — for the daily goal ring. */
export function minutesToday(entries: HistoryEntry[], now = Date.now()): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let seconds = 0;
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || e.ts < start) continue;
    const dur = e.song?.duration ?? 0;
    // A completed play counts in full; a skip is credited a third of the track.
    seconds += e.completed ? dur : Math.min(dur, Math.max(30, dur / 3));
  }
  return Math.round(seconds / 60);
}
