/**
 * 1.12 — badges, worked out on the device.
 *
 * History keeps only the last 150 plays, so the lifetime figures behind the
 * badges (plays, late-night plays, languages, artists) live in a small
 * ledger (`vinax.badges.v1`) that moves forward with every new play it has
 * not counted yet: `advanceCounters` reads the history entries newer than
 * the last one it saw. The ledger also holds the day each badge was earned,
 * so a badge never goes away once the plays behind it leave the history.
 * The ledger travels in the backup (the extras category) and merges by
 * union: the earliest day wins, the counters take the larger side.
 *
 * `checkBadges` is the one entry point: it advances the counters, marks what
 * is newly earned, saves, and answers every badge's progress. `afterPlay`
 * runs it a moment after a play is recorded and announces new badges.
 */
import type { HistoryEntry } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { creditedSeconds } from '@/features/stats/listening';
import { localDayKey } from '@/features/stats/calendar';
import { loadLedger as loadGoalLedger, weekStreak } from '@/features/stats/goals';
import { isoWeekKey } from '@/features/weekly/weekKey';
import { BADGES, BADGE_ID_RE, type BadgeDef } from './catalog';

export interface BadgeCounters {
  plays: number;
  /** Plays started between midnight and 4 AM, local time. */
  night: number;
  /** Plays started between 5 and 9 AM, local time. */
  morning: number;
  /** The newest history timestamp already counted. */
  lastTs: number;
  languages: string[];
  /** Plays per lead artist; pruned to the top 400 once it passes 500 names. */
  artists: Record<string, number>;
  /** The most minutes listened in one local day. */
  bestDayMin: number;
}

export interface BadgeLedger {
  /** Badge id → the local day it was earned (YYYY-MM-DD). */
  earned: Record<string, string>;
  counters: BadgeCounters;
}

export const emptyCounters = (): BadgeCounters => ({ plays: 0, night: 0, morning: 0, lastTs: 0, languages: [], artists: {}, bestDayMin: 0 });
export const emptyLedger = (): BadgeLedger => ({ earned: {}, counters: emptyCounters() });

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A ledger from untrusted JSON (storage, a backup file): shape enforced, nothing else trusted. */
export function sanitizeLedger(raw: unknown): BadgeLedger {
  const out = emptyLedger();
  if (!isObj(raw)) return out;
  if (isObj(raw.earned)) {
    for (const [id, day] of Object.entries(raw.earned)) {
      if (BADGE_ID_RE.test(id) && typeof day === 'string' && DAY_RE.test(day)) out.earned[id] = day;
    }
  }
  const c = isObj(raw.counters) ? raw.counters : {};
  out.counters = {
    plays: Math.round(num(c.plays)),
    night: Math.round(num(c.night)),
    morning: Math.round(num(c.morning)),
    lastTs: num(c.lastTs),
    languages: Array.isArray(c.languages) ? [...new Set(c.languages.filter((l): l is string => typeof l === 'string' && !!l).map((l) => l.toLowerCase().slice(0, 24)))].slice(0, 40) : [],
    artists: isObj(c.artists) ? Object.fromEntries(Object.entries(c.artists).filter(([k, v]) => k && typeof v === 'number' && Number.isFinite(v) && v > 0).slice(0, 500).map(([k, v]) => [k.slice(0, 80), Math.round(v as number)])) : {},
    bestDayMin: Math.round(num(c.bestDayMin)),
  };
  return out;
}

export function loadLedger(): BadgeLedger {
  return sanitizeLedger(getLocal<unknown>(KEYS.badges, null));
}

export function saveLedger(ledger: BadgeLedger): void {
  setLocal(KEYS.badges, ledger);
}

/** Two ledgers into one: a badge keeps its earliest day; each counter takes the larger side. */
export function mergeLedgers(a: BadgeLedger, b: BadgeLedger): BadgeLedger {
  const earned: Record<string, string> = { ...a.earned };
  for (const [id, day] of Object.entries(b.earned)) earned[id] = earned[id] && earned[id] <= day ? earned[id] : day;
  const artists: Record<string, number> = { ...a.counters.artists };
  for (const [k, v] of Object.entries(b.counters.artists)) artists[k] = Math.max(artists[k] ?? 0, v);
  return {
    earned,
    counters: {
      plays: Math.max(a.counters.plays, b.counters.plays),
      night: Math.max(a.counters.night, b.counters.night),
      morning: Math.max(a.counters.morning, b.counters.morning),
      lastTs: Math.max(a.counters.lastTs, b.counters.lastTs),
      languages: [...new Set([...a.counters.languages, ...b.counters.languages])].slice(0, 40),
      artists: pruneArtists(artists),
      bestDayMin: Math.max(a.counters.bestDayMin, b.counters.bestDayMin),
    },
  };
}

function pruneArtists(artists: Record<string, number>): Record<string, number> {
  const names = Object.keys(artists);
  if (names.length <= 500) return artists;
  return Object.fromEntries(names.map((n) => [n, artists[n]] as const).sort((x, y) => y[1] - x[1]).slice(0, 400));
}

/** The lead artist of a play, the way the Stats page names it. */
export function leadArtist(e: HistoryEntry): string | null {
  const s = e.song;
  const name = s.artists?.[0]?.name ?? s.subtitle?.split(',')[0]?.trim() ?? '';
  return name ? name.slice(0, 80) : null;
}

/**
 * Count the plays the ledger has not seen yet (newer than `lastTs`, not in
 * the future), and refresh the best day from the whole history. Pure.
 */
export function advanceCounters(ledger: BadgeLedger, entries: readonly HistoryEntry[], now = Date.now()): BadgeLedger {
  const c: BadgeCounters = { ...ledger.counters, languages: [...ledger.counters.languages], artists: { ...ledger.counters.artists } };
  const langs = new Set(c.languages);
  const daySecs = new Map<string, number>();
  for (const e of entries) {
    if (typeof e?.ts !== 'number' || !e.song || e.ts > now + 60_000) continue;
    const k = localDayKey(e.ts);
    daySecs.set(k, (daySecs.get(k) ?? 0) + creditedSeconds(e).seconds);
    if (e.ts <= c.lastTs) continue;
    c.plays += 1;
    const h = new Date(e.ts).getHours();
    if (h < 4) c.night += 1;
    else if (h >= 5 && h < 9) c.morning += 1;
    const lang = e.song.language?.toLowerCase().trim();
    if (lang && lang !== 'unknown' && langs.size < 40) langs.add(lang.slice(0, 24));
    const artist = leadArtist(e);
    if (artist) c.artists[artist] = (c.artists[artist] ?? 0) + 1;
  }
  c.lastTs = Math.max(c.lastTs, ...entries.map((e) => (typeof e?.ts === 'number' && e.ts <= now + 60_000 ? e.ts : 0)));
  c.languages = [...langs];
  c.artists = pruneArtists(c.artists);
  for (const s of daySecs.values()) c.bestDayMin = Math.max(c.bestDayMin, Math.round(s / 60));
  return { earned: ledger.earned, counters: c };
}

export interface BadgeInputs {
  ledger: BadgeLedger;
  /** The longest listening streak reached (utils/streak best, or the live one when longer). */
  streakDays: number;
  favorites: number;
  playlists: number;
  /** Weeks in a row a weekly goal was met (the better of the two goals). */
  goalWeeks: number;
}

export interface BadgeProgress {
  def: BadgeDef;
  earnedAt: string | null;
  value: number;
  pct: number;
}

/** The figure each badge is measured by. */
export function badgeValue(def: BadgeDef, inp: BadgeInputs): number {
  const c = inp.ledger.counters;
  switch (def.id) {
    case 'first-note': case 'century': case 'marathoner': case 'thousand': return c.plays;
    case 'streak-7': case 'streak-30': case 'streak-100': return inp.streakDays;
    case 'night-owl': return c.night;
    case 'early-bird': return c.morning;
    case 'all-day': return c.bestDayMin;
    case 'three-tongues': case 'polyglot': return c.languages.length;
    case 'explorer': return Object.keys(c.artists).length;
    case 'superfan': return Math.max(0, ...Object.values(c.artists));
    case 'collector': return inp.favorites;
    case 'curator': return inp.playlists;
    case 'four-weeks': return inp.goalWeeks;
    default: return 0;
  }
}

/** Every badge's progress, earned ones first (newest first), then the nearest. Pure. */
export function evaluate(inp: BadgeInputs): BadgeProgress[] {
  const rows = BADGES.map((def) => {
    const value = badgeValue(def, inp);
    const earnedAt = inp.ledger.earned[def.id] ?? null;
    return { def, earnedAt, value, pct: earnedAt ? 100 : Math.min(100, Math.round((value / def.target) * 100)) };
  });
  return rows.sort((a, b) => (a.earnedAt && b.earnedAt ? b.earnedAt.localeCompare(a.earnedAt) : a.earnedAt ? -1 : b.earnedAt ? 1 : b.pct - a.pct));
}

export const earnedIds = (ledger: BadgeLedger): string[] => Object.entries(ledger.earned).sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);

/** Weeks in a row either weekly goal was met, from the goals ledger. */
export function goalWeeksNow(now = new Date()): number {
  const ledger = loadGoalLedger();
  const week = isoWeekKey(now);
  return Math.max(...(['minutes', 'artists'] as const).map((k) => weekStreak(k, week, ledger.met[k].includes(week), ledger)));
}

export interface CheckOptions {
  entries: readonly HistoryEntry[];
  streakDays: number;
  favorites: number;
  playlists: number;
  goalWeeks?: number;
  now?: number;
}

export interface CheckResult {
  progress: BadgeProgress[];
  /** Badges earned by this check, in catalogue order. */
  newlyEarned: BadgeDef[];
  ledger: BadgeLedger;
}

/** Advance the counters, award what is due, save, and answer every badge's progress. */
export function checkBadges(o: CheckOptions): CheckResult {
  const now = o.now ?? Date.now();
  const ledger = advanceCounters(loadLedger(), o.entries, now);
  const inputs: BadgeInputs = { ledger, streakDays: o.streakDays, favorites: o.favorites, playlists: o.playlists, goalWeeks: o.goalWeeks ?? goalWeeksNow(new Date(now)) };
  const today = localDayKey(now);
  const newlyEarned: BadgeDef[] = [];
  for (const def of BADGES) {
    if (ledger.earned[def.id]) continue;
    if (badgeValue(def, inputs) >= def.target) {
      ledger.earned[def.id] = today;
      newlyEarned.push(def);
    }
  }
  saveLedger(ledger);
  return { progress: evaluate(inputs), newlyEarned, ledger };
}
