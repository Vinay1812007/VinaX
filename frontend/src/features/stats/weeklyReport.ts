import type { HistoryEntry } from '@/types';
import { creditedSeconds, historyCoverage, type HistoryCoverage } from './listening';

/**
 * v5.17.0 — Weekly report card: this week (rolling 7 days) against the 7 days
 * before it, from on-device history only. Pure, so it is unit-tested.
 *
 * Minutes follow the shared listening rule (./listening.ts): measured
 * playback when the player recorded it, otherwise a completed play counts in
 * full and an unfinished one a third of the track (30s floor). "New artists"
 * are names that appear in the window and never before it. `coverage` says
 * whether the 150-play history cap cut the two-week comparison short.
 */
export interface WeekSummary {
  minutes: number;
  /** True when any play in the week was estimated rather than measured. */
  estimated: boolean;
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
  /** Does retained history reach back the full two weeks? */
  coverage: HistoryCoverage;
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
  let estimated = false;
  const fresh = new Set<string>();
  for (const e of inWindow) {
    const c = creditedSeconds(e);
    seconds += c.seconds;
    if (!c.measured) estimated = true;
    const a = entryArtist(e);
    artists.set(a, (artists.get(a) ?? 0) + 1);
    if (!seenBefore.has(a)) fresh.add(a);
    const l = entryLanguage(e);
    if (l) langs.set(l, (langs.get(l) ?? 0) + 1);
  }
  return {
    minutes: Math.round(seconds / 60),
    estimated,
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
    coverage: historyCoverage(entries, now - 2 * WEEK),
  };
}
