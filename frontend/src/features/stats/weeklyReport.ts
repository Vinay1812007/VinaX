import type { HistoryEntry } from '@/types';

/**
 * v5.17.0 — Weekly report card: this week (rolling 7 days) against the 7 days
 * before it, from on-device history only. Pure, so it is unit-tested.
 *
 * Minutes follow the daily-goal rule: a completed play counts in full, an
 * unfinished one is credited a third of the track (30s floor). "New artists"
 * are names that appear in the window and never before it.
 */
export interface WeekSummary {
  minutes: number;
  songs: number;
  newArtists: number;
  topArtist: string | null;
  topLanguage: string | null;
}

export interface WeeklyReport {
  thisWeek: WeekSummary;
  lastWeek: WeekSummary;
  /** this − last, so positive means "up". */
  delta: { minutes: number; songs: number; newArtists: number };
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function entryArtist(e: HistoryEntry): string {
  return e.song.artists?.[0]?.name ?? e.song.subtitle?.split(',')[0]?.trim() ?? 'Unknown';
}

export function entryLanguage(e: HistoryEntry): string | null {
  const l = e.song.language;
  if (!l || l === 'unknown') return null;
  return l[0].toUpperCase() + l.slice(1);
}

function creditedSeconds(e: HistoryEntry): number {
  const dur = e.song.duration ?? 0;
  return e.completed ? dur : Math.min(dur, Math.max(30, dur / 3));
}

function topKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function summarise(entries: HistoryEntry[], from: number, to: number): WeekSummary {
  const artists = new Map<string, number>();
  const langs = new Map<string, number>();
  const seenBefore = new Set<string>();
  const inWindow: HistoryEntry[] = [];
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song) continue;
    if (e.ts >= from && e.ts < to) inWindow.push(e);
    else if (e.ts < from) seenBefore.add(entryArtist(e));
  }
  let seconds = 0;
  const fresh = new Set<string>();
  for (const e of inWindow) {
    seconds += creditedSeconds(e);
    const a = entryArtist(e);
    artists.set(a, (artists.get(a) ?? 0) + 1);
    if (!seenBefore.has(a)) fresh.add(a);
    const l = entryLanguage(e);
    if (l) langs.set(l, (langs.get(l) ?? 0) + 1);
  }
  return {
    minutes: Math.round(seconds / 60),
    songs: inWindow.length,
    newArtists: fresh.size,
    topArtist: topKey(artists),
    topLanguage: topKey(langs),
  };
}

export function weeklyReport(entries: HistoryEntry[], now = Date.now()): WeeklyReport {
  const thisWeek = summarise(entries, now - WEEK, now + 1);
  const lastWeek = summarise(entries, now - 2 * WEEK, now - WEEK);
  return {
    thisWeek,
    lastWeek,
    delta: {
      minutes: thisWeek.minutes - lastWeek.minutes,
      songs: thisWeek.songs - lastWeek.songs,
      newArtists: thisWeek.newArtists - lastWeek.newArtists,
    },
  };
}
