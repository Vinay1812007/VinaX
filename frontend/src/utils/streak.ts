const KEY = 'vinax.streak.v1';

interface StreakData {
  count: number;
  lastDay: string; // YYYY-MM-DD
  best?: number;
}

/** C6 — UTC day key. Local dates made streaks fragile: a timezone change or a
 *  DST jump could skip or repeat a "day" and silently break (or double-earn)
 *  a streak. UTC days are uniform 24h everywhere, so travel can't touch them.
 *  Exported for the boundary tests. Migration note: previously-stored local
 *  keys differ from UTC keys by at most one day, so the worst one-time effect
 *  on an existing streak is one extra qualifying day — never a reset. */
export function dayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}
const dayStr = dayKey;

function read(): StreakData {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as StreakData;
  } catch {
    /* ignore */
  }
  return { count: 0, lastDay: '', best: 0 };
}

/** Call on each play; returns the current consecutive-day streak. */
export function bumpStreak(): number {
  try {
    const today = dayStr();
    const data = read();
    if (data.lastDay === today) return data.count;
    const yesterday = dayStr(Date.now() - 86_400_000);
    const count = data.lastDay === yesterday ? data.count + 1 : 1;
    const best = Math.max(data.best ?? data.count ?? 0, count);
    window.localStorage.setItem(KEY, JSON.stringify({ count, lastDay: today, best }));
    return count;
  } catch {
    return 0;
  }
}

export function getStreak(): number {
  const data = read();
  if (!data.lastDay) return 0;
  const valid = data.lastDay === dayStr() || data.lastDay === dayStr(Date.now() - 86_400_000);
  return valid ? data.count : 0;
}

/** Longest consecutive-day streak ever reached (a personal record). */
export function getBestStreak(): number {
  const data = read();
  return data.best ?? data.count ?? 0;
}
