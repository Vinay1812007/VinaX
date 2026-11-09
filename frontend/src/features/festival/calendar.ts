import { FESTIVALS, activeFestival, type Festival } from '@/constants/festivals';

/**
 * 1.12 — the festival calendar as dates, for the Festivals page and its live
 * countdown. The windows in constants/festivals.ts are month/day pairs that
 * repeat yearly (lunar dates carry the current year's values); this turns
 * them into "the next time this festival starts", "when today's festival
 * ends" and the list of what comes next. Pure: every function takes `now`.
 */

const DAY_MS = 86_400_000;

export interface FestivalOccurrence {
  festival: Festival;
  /** Local midnight of the first day. */
  start: Date;
  /** Local end of the last day (23:59:59.999). */
  end: Date;
  /** Whole days from `now`'s date to the start (0 = today, negative = running). */
  inDays: number;
}

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The window of `f` that contains `date`, as dates, or null. */
export function windowAround(f: Festival, date: Date): { start: Date; end: Date } | null {
  const v = (date.getMonth() + 1) * 100 + date.getDate();
  const y = date.getFullYear();
  for (const [mf, df, mt, dt] of f.windows) {
    if (v < mf * 100 + df || v > mt * 100 + dt) continue;
    return { start: new Date(y, mf - 1, df), end: new Date(y, mt - 1, dt, 23, 59, 59, 999) };
  }
  return null;
}

/**
 * Festivals starting after today, in order, each once. Walks the calendar day
 * by day (366 days wraps into next year) so overlaps and first-window-wins
 * shadowing are resolved the same way the app resolves "today's festival".
 */
export function upcomingFestivals(now: Date, limit = 8): FestivalOccurrence[] {
  const today = midnight(now);
  const out: FestivalOccurrence[] = [];
  const seen = new Set<string>();
  const current = activeFestival(now);
  if (current) seen.add(current.id);
  let prev: Festival | null = current;
  for (let i = 1; i <= 366 && out.length < limit; i++) {
    const day = new Date(today.getTime() + i * DAY_MS);
    const f = activeFestival(day);
    if (f && f !== prev && !seen.has(f.id)) {
      const w = windowAround(f, day);
      if (w) {
        seen.add(f.id);
        out.push({ festival: f, start: w.start, end: w.end, inDays: i });
      }
    }
    prev = f;
  }
  return out;
}

/** Today's festival with its dates, or null. */
export function currentOccurrence(now: Date): FestivalOccurrence | null {
  const f = activeFestival(now);
  if (!f) return null;
  const w = windowAround(f, now);
  if (!w) return null;
  return { festival: f, start: w.start, end: w.end, inDays: 0 };
}

/** The next start of one festival (this year's if still ahead, else next year's); null for force-only days. */
export function nextStartOf(f: Festival, now: Date): Date | null {
  if (!f.windows.length) return null;
  const y = now.getFullYear();
  const starts = f.windows.flatMap(([mf, df]) => [new Date(y, mf - 1, df), new Date(y + 1, mf - 1, df)]);
  const today = midnight(now).getTime();
  const ahead = starts.filter((d) => d.getTime() >= today).sort((a, b) => a.getTime() - b.getTime());
  return ahead[0] ?? null;
}

export interface Countdown { days: number; hours: number; minutes: number; seconds: number; total: number }

/** Time left until `to`, split for a clock; all zeros once it has passed. */
export function countdownTo(to: Date, now: Date): Countdown {
  const total = Math.max(0, to.getTime() - now.getTime());
  const s = Math.floor(total / 1000);
  return { total, days: Math.floor(s / 86_400), hours: Math.floor((s % 86_400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

/** "Nov 6" or "Nov 6 – 10" for a window. */
export function rangeLabel(start: Date, end: Date): string {
  const f = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) return f(start);
  return start.getMonth() === end.getMonth() ? `${f(start)} – ${end.getDate()}` : `${f(start)} – ${f(end)}`;
}

/** Every festival that can switch on by itself (has a window), ordered by its next start. */
export function festivalsByNextStart(now: Date): Array<{ festival: Festival; start: Date | null }> {
  return FESTIVALS.map((festival) => ({ festival, start: nextStartOf(festival, now) }))
    .sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
}

/** "Diwali" from "Diwali (Dhanteras → Bhai Dooj)"; "Sankranti" from "Sankranti · Pongal · Lohri". */
export function shortName(name: string): string {
  const first = name.split('·')[0]!.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return first || name.trim();
}
