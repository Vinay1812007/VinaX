import type { HistoryEntry, Song } from '@/types';
import { energyOfSong } from './session';

/**
 * 1.12 — Listening moments: what THIS listener usually plays at this time of
 * day on this kind of day, read from their own play history on the device.
 * A weekday morning commute, a weekend afternoon, a late weeknight: each is a
 * moment with its own languages, artists and energy. The moment feeds three
 * places — Up Next's scorer (a bonus for the languages and artists of this
 * moment), the "This moment" line in Up Next and a Home shelf ("For your
 * weekday evenings"). It is all worked out on the device; nothing leaves it.
 */
export type MomentPart = 'early-morning' | 'morning' | 'afternoon' | 'evening' | 'night' | 'late-night';

export interface Moment {
  part: MomentPart;
  weekend: boolean;
  /** "weekday evening", "weekend morning". */
  label: string;
}

export interface MomentProfile extends Moment {
  /** Plays recorded in this moment over the window. */
  plays: number;
  /** 0..1 — how much to trust the pattern (10 plays and up is 1). */
  confidence: number;
  /** Lowercase language ids, most played first. */
  languages: string[];
  /** Lead artists (as shown), most played first. */
  artists: Array<{ name: string; key: string; plays: number }>;
  /** Mean energy 0..1 of the songs played in this moment, or null. */
  energy: number | null;
}

/** Plays older than this are not this listener's habit any more. */
export const MOMENT_WINDOW_MS = 90 * 86_400_000;
/** Plays in the moment at which the pattern is fully trusted. */
export const MOMENT_FULL_PLAYS = 10;
/** Below this many plays the moment says nothing. */
export const MOMENT_MIN_PLAYS = 4;

export function partOfHour(hour: number): MomentPart {
  if (hour < 5) return 'late-night';
  if (hour < 8) return 'early-morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

const PART_WORD: Record<MomentPart, string> = {
  'early-morning': 'early morning', morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night', 'late-night': 'late night',
};

export function momentOf(date: Date): Moment {
  const part = partOfHour(date.getHours());
  const day = date.getDay();
  // Saturday and Sunday; Friday night counts as the weekend too.
  const weekend = day === 0 || day === 6 || (day === 5 && (part === 'night' || part === 'late-night'));
  return { part, weekend, label: `${weekend ? 'weekend' : 'weekday'} ${PART_WORD[part]}` };
}

/** "For your weekday evenings" */
export function momentShelfTitle(m: Moment): string {
  return `For your ${m.label}s`;
}

export const leadArtistOf = (song: Song): string => (song.artists?.[0]?.name ?? song.subtitle?.split(',')[0] ?? '').trim();

/**
 * The listener's pattern for the moment `now` falls in, from `history`
 * (newest first or any order). Plays inside the window whose moment matches
 * count; a completed play counts twice as much as an abandoned one.
 */
export function momentProfile(history: readonly HistoryEntry[], now: Date = new Date()): MomentProfile {
  const m = momentOf(now);
  const since = now.getTime() - MOMENT_WINDOW_MS;
  const langs = new Map<string, number>();
  const artists = new Map<string, { name: string; plays: number }>();
  let plays = 0;
  let energySum = 0;
  let energyN = 0;
  for (const h of history) {
    if (!h || typeof h.ts !== 'number' || h.ts < since || !h.song) continue;
    const at = momentOf(new Date(h.ts));
    if (at.part !== m.part || at.weekend !== m.weekend) continue;
    const w = h.completed ? 1 : 0.5;
    plays += 1;
    const lang = h.song.language && h.song.language !== 'unknown' ? h.song.language.toLowerCase() : null;
    if (lang) langs.set(lang, (langs.get(lang) ?? 0) + w);
    const name = leadArtistOf(h.song);
    if (name) {
      const key = name.toLowerCase();
      const row = artists.get(key) ?? { name, plays: 0 };
      row.plays += w;
      artists.set(key, row);
    }
    const e = energyOfSong(h.song);
    if (Number.isFinite(e)) { energySum += e; energyN += 1; }
  }
  const top = <T,>(map: Map<string, T>, n: number, of: (v: T) => number): Array<[string, T]> => [...map.entries()].sort((a, b) => of(b[1]) - of(a[1])).slice(0, n);
  return {
    ...m,
    plays,
    confidence: plays < MOMENT_MIN_PLAYS ? 0 : Math.min(1, plays / MOMENT_FULL_PLAYS),
    languages: top(langs, 3, (v) => v).map(([k]) => k),
    artists: top(artists, 5, (v) => v.plays).map(([key, v]) => ({ name: v.name, key, plays: Math.round(v.plays * 2) / 2 })),
    energy: energyN ? Math.round((energySum / energyN) * 100) / 100 : null,
  };
}

/** One line a listener reads about the moment ("Weekday evenings you play Sid Sriram and Anirudh, mostly Telugu"). */
export function momentLine(p: MomentProfile): string | null {
  if (!p.confidence) return null;
  const who = p.artists.slice(0, 2).map((a) => a.name);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const lang = p.languages[0] ? `, mostly ${cap(p.languages[0])}` : '';
  if (!who.length) return `${cap(p.label)}s: ${p.plays} plays in the last three months${lang}`;
  return `${cap(p.label)}s you play ${who.join(' and ')}${lang}`;
}
