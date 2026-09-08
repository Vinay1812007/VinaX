import type { HistoryEntry } from '@/types';

/**
 * v5.17.0 — Listening streak from history alone (the older utils/streak counter
 * is bumped per play; this one is derived, so it can be unit-tested and never
 * drifts from what History actually shows). A day counts when it has at least
 * one completed play or three plays. Pure.
 */
export interface StreakInfo {
  /** Consecutive qualifying days ending today (or yesterday, if today is still open). */
  days: number;
  /** Next milestone to reach, or null once past the last one. */
  nextMilestone: number | null;
  /** 0–1 progress toward the next milestone (1 when there is none). */
  progress: number;
  /** Whether today has already earned its day. */
  todayCounts: boolean;
}

export const STREAK_MILESTONES = [7, 14, 30, 100, 365] as const;

const DAY = 86_400_000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Local day keys that qualify (≥1 completed play or ≥3 plays). */
export function qualifyingDays(entries: HistoryEntry[]): Set<string> {
  const plays = new Map<string, number>();
  const done = new Set<string>();
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song) continue;
    const k = dayKey(e.ts);
    plays.set(k, (plays.get(k) ?? 0) + 1);
    if (e.completed) done.add(k);
  }
  const out = new Set<string>(done);
  for (const [k, n] of plays) if (n >= 3) out.add(k);
  return out;
}

export function streakInfo(entries: HistoryEntry[], now = Date.now()): StreakInfo {
  const days = qualifyingDays(entries);
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayCounts = days.has(dayKey(today));
  let count = 0;
  let cursor = todayCounts ? today : today - DAY;
  while (days.has(dayKey(cursor))) {
    count += 1;
    // Step by calendar day so DST never skips or doubles a date.
    const c = new Date(cursor);
    cursor = new Date(c.getFullYear(), c.getMonth(), c.getDate() - 1).getTime();
  }
  const next = STREAK_MILESTONES.find((m) => m > count) ?? null;
  const prevIdx = next === null ? -1 : STREAK_MILESTONES.indexOf(next) - 1;
  const floor = prevIdx >= 0 ? STREAK_MILESTONES[prevIdx] : 0;
  const progress = next === null ? 1 : Math.min(1, Math.max(0, (count - floor) / (next - floor)));
  return { days: count, nextMilestone: next, progress, todayCounts };
}
