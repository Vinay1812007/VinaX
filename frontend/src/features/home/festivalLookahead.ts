/**
 * v5.19.0 — festival lookahead for Home. When the next festival on the
 * calendar is one to three days out (and none is on today), the personal band
 * shows a compact "Coming up" card so the listener can queue the mood early.
 * Pure: takes a date and the festival-skins setting, returns everything the
 * card needs (or null when there is nothing to say).
 */
import { activeFestival, nextFestival, type Festival } from '@/constants/festivals';
import { FESTIVAL_THEMES } from '@/constants/festivalThemes';

export const LOOKAHEAD_MAX_DAYS = 3;

export interface FestivalLookahead {
  festival: Festival;
  inDays: number;
  /** Short display name: the first "·"-separated part, parentheticals dropped. */
  shortName: string;
  /** "{shortName} in N days" */
  title: string;
  /** One line under the title — depends on the festival-skins setting. */
  note: string;
  /** Theme swatch accent (hex); falls back to the festival's first colour. */
  accent: string;
  /** Theme ribbon stops (hex), left to right. */
  ribbon: string[];
  /** Catalog query behind "Play {shortName} songs". */
  query: string;
}

/** "Diwali (Dhanteras → Bhai Dooj)" → "Diwali"; "Sankranti · Pongal · Lohri" → "Sankranti". */
export function festivalShortName(name: string): string {
  const first = name.split('·')[0].replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return first || name.trim();
}

export function ribbonGradient(stops: ReadonlyArray<string>): string {
  const list = stops.length > 1 ? stops : [...stops, ...stops];
  return `linear-gradient(90deg, ${list.join(', ')})`;
}

export function festivalLookahead(now: Date = new Date(), skinsOn = true): FestivalLookahead | null {
  if (activeFestival(now)) return null;
  const next = nextFestival(now);
  if (!next || next.inDays < 1 || next.inDays > LOOKAHEAD_MAX_DAYS) return null;
  const { festival, inDays } = next;
  const theme = FESTIVAL_THEMES[festival.id];
  const shortName = festivalShortName(festival.name);
  const note = !skinsOn
    ? 'Festival themes are off in Settings'
    : inDays === 1
      ? 'The app is dressed up for it from today'
      : 'The app dresses up for it the day before';
  return {
    festival,
    inDays,
    shortName,
    title: `${shortName} in ${inDays} day${inDays === 1 ? '' : 's'}`,
    note,
    accent: theme?.accent ?? festival.colors[0],
    ribbon: theme?.ribbon?.length ? theme.ribbon : festival.colors,
    query: `${shortName} songs`,
  };
}
