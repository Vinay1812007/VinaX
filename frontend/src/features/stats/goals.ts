/**
 * 15.0 — weekly goals and streaks, computed on the device.
 *
 * Two goals, each off by default (Settings → Playback → Your goal):
 * - minutes a week (`weeklyGoalMinutes`), from the history's measured
 *   listening time, the same figure the Stats page shows;
 * - new artists a week (`weeklyGoalArtists`): artists first heard this week,
 *   measured against everything heard before it.
 *
 * History holds the last 150 plays, so a week older than that cannot be
 * recomputed. The weeks a goal was met are therefore kept in a small ledger
 * (`vinax.goal-ledger.v1`) as each week closes, and the streak counts weeks
 * met back from the current one in that ledger. A reset of the history
 * clears the ledger too (same storage sweep).
 */
import type { HistoryEntry } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isoWeekKey } from '@/features/weekly/useWeeklyMix';
import { listeningTotal } from '@/features/stats/listening';

export interface WeekGoal {
  kind: 'minutes' | 'artists';
  goal: number;
  /** Progress so far this week. */
  value: number;
  pct: number;
  met: boolean;
  /** Weeks met in a row, counting this week only once it is met. */
  streak: number;
  /** How many days of the week remain, today included. */
  daysLeft: number;
}

export interface GoalLedger { met: Record<'minutes' | 'artists', string[]> }

/** Monday 00:00 local of the week containing `now`. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

const artistKey = (name: string): string => name.trim().toLowerCase();

/** Artists first heard in [from, to) that were never heard before `from`. */
export function newArtistsThisWeek(entries: readonly HistoryEntry[], from: number, to = Infinity): string[] {
  const before = new Set<string>();
  const during = new Map<string, string>();
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song) continue;
    const names = e.song.artists?.length ? e.song.artists.map((a) => a.name) : e.song.subtitle.split(',');
    for (const raw of names) {
      const k = artistKey(raw);
      if (!k) continue;
      if (e.ts < from) before.add(k);
      else if (e.ts < to) during.set(k, raw.trim());
    }
  }
  return [...during].filter(([k]) => !before.has(k)).map(([, name]) => name);
}

/** The key of the ISO week `n` weeks before `week` (YYYY-Www). */
export function previousWeekKey(week: string, n = 1): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return week;
  // Thursday of that ISO week, minus n weeks, keyed again.
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - day * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000);
  const target = new Date(monday.getTime() - n * 7 * 86_400_000 + 3 * 86_400_000);
  return isoWeekKey(target);
}

export function loadLedger(): GoalLedger {
  const l = getLocal<GoalLedger | null>(KEYS.goalLedger, null);
  return l && l.met ? { met: { minutes: l.met.minutes ?? [], artists: l.met.artists ?? [] } } : { met: { minutes: [], artists: [] } };
}

/** Record this week as met (idempotent), keeping the last 60 weeks. */
export function markWeekMet(kind: 'minutes' | 'artists', week: string, ledger = loadLedger()): GoalLedger {
  if (ledger.met[kind].includes(week)) return ledger;
  const next: GoalLedger = { met: { ...ledger.met, [kind]: [...ledger.met[kind], week].slice(-60) } };
  setLocal(KEYS.goalLedger, next);
  return next;
}

/** Consecutive weeks met ending at `week` (inclusive when met, else from the week before). */
export function weekStreak(kind: 'minutes' | 'artists', week: string, metThisWeek: boolean, ledger = loadLedger()): number {
  const set = new Set(ledger.met[kind]);
  let n = 0;
  let w = metThisWeek ? week : previousWeekKey(week);
  while (set.has(w) && n < 520) {
    n += 1;
    w = previousWeekKey(w);
  }
  return n;
}

export function weekGoals(entries: readonly HistoryEntry[], goals: { minutes: number; artists: number }, now = new Date()): WeekGoal[] {
  const from = weekStart(now).getTime();
  const week = isoWeekKey(now);
  const daysLeft = 7 - ((now.getDay() + 6) % 7);
  const out: WeekGoal[] = [];
  let ledger = loadLedger();
  const build = (kind: 'minutes' | 'artists', goal: number, value: number): WeekGoal => {
    const met = goal > 0 && value >= goal;
    if (met) ledger = markWeekMet(kind, week, ledger);
    return { kind, goal, value, pct: goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0, met, streak: weekStreak(kind, week, met, ledger), daysLeft };
  };
  if (goals.minutes > 0) out.push(build('minutes', goals.minutes, Math.round(listeningTotal(entries, from).seconds / 60)));
  if (goals.artists > 0) out.push(build('artists', goals.artists, newArtistsThisWeek(entries, from).length));
  return out;
}
