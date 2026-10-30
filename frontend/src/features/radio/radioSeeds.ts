import type { Song } from '@/types';
import type { TuneIntent } from '@/services/recommendation/tune';
import { matchesStyle, type MusicStyle } from '@/services/recommendation/style';
import { songKey } from '@/services/recommendation/songIdentity';

/**
 * 8.2.0 — Radio: endless music from a song, an artist or a mood. This
 * module picks the SEEDS (the first few songs); the player's radio mode
 * takes it from there on the device (playerStore.startRadio with `seeds`
 * and a `tune`).
 */

export interface RadioMood {
  id: TuneIntent;
  label: string;
}

/** Mood chips on the Radio page, each a tune the radio keeps following. */
export const RADIO_MOODS: readonly RadioMood[] = [
  { id: 'melody', label: 'Melody' },
  { id: 'romantic', label: 'Romantic' },
  { id: 'energetic', label: 'Dance' },
  { id: 'chill', label: 'Chill' },
  { id: 'heartbreak', label: 'Sad' },
  { id: 'devotional', label: 'Devotional' },
  // 8.3.0 — styles: the radio keeps playing DJ remixes / folk songs, not just songs that feel alike.
  { id: 'dj', label: 'DJ remix' },
  { id: 'folk', label: 'Folk' },
  { id: 'mass', label: 'Beats' },
  { id: 'classics', label: 'Classics' },
  { id: 'fresh', label: 'New' },
];

const yearOf = (s: Song): number | null => {
  const y = Number.parseInt(String(s.year ?? ''), 10);
  return Number.isFinite(y) && y > 1900 ? y : null;
};

export interface PickOptions {
  /** Keep only songs in this language (songs with no known language stay). */
  language?: string | null;
  /** Prefer songs from this decade (e.g. 1990). */
  decade?: number | null;
  /** Songs the listener has hidden or blocked. */
  blocked?: (s: Song) => boolean;
  /** Start this many places into the merged list, so the same mood does not always open the same way. */
  rotate?: number;
  max?: number;
  /** 8.3.0 — songs in this style (DJ remix, folk, devotional) open the radio; the rest only fill in. */
  style?: MusicStyle | null;
  /** 13.1 — songs credited to this artist open the radio ("songs like <artist>"); the rest only fill in. */
  artist?: string | null;
}

/**
 * Merge result lists into radio seeds: round-robin across the lists (so each
 * query contributes), distinct songs and titles, language kept, the asked-for
 * decade first. Pure.
 */
export function pickRadioSeeds(lists: Song[][], opts: PickOptions = {}): Song[] {
  const { language = null, decade = null, blocked, rotate = 0, max = 5, style = null, artist = null } = opts;
  const merged: Song[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  // 8.3.0 — one cut per song: "Nadakallo Nadaka (DJ Remix Song)" and its "Version 5" are one seed.
  const works = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const s = list[i];
      if (!s || ids.has(s.id)) continue;
      const title = s.title.trim().toLowerCase();
      if (titles.has(title) || works.has(songKey(s))) continue;
      if (language && s.language && s.language !== 'unknown' && s.language !== language) continue;
      if (blocked?.(s)) continue;
      ids.add(s.id);
      titles.add(title);
      works.add(songKey(s));
      merged.push(s);
    }
  }
  const inDecade = (s: Song) => {
    const y = yearOf(s);
    return decade !== null && y !== null && y >= decade && y < decade + 10;
  };
  // 13.1 — a named artist outranks everything: their songs open the radio.
  const want = (artist ?? '').trim().toLowerCase();
  const credited = (s: Song): boolean => !!want && (s.artists.some((a) => a.name.trim().toLowerCase() === want) || s.subtitle.toLowerCase().includes(want));
  const byName = want ? [...merged.filter(credited), ...merged.filter((s) => !credited(s))] : merged;
  const styled = style ? [...byName.filter((s) => matchesStyle(s, style)), ...byName.filter((s) => !matchesStyle(s, style))] : byName;
  const ordered = decade !== null ? [...styled.filter(inDecade), ...styled.filter((s) => !inDecade(s))] : styled;
  if (!ordered.length) return [];
  const shift = Math.max(0, Math.floor(rotate)) % ordered.length;
  // Rotation only within the best part of the list, so a decade request still opens in its decade.
  // 8.3.0 — a style request rotates among its style songs only, so it always opens in the style.
  // 13.1 — an artist request rotates among that artist's songs only.
  const best = want && byName.some(credited)
    ? Math.max(1, ordered.filter(credited).length)
    : decade !== null ? Math.max(1, ordered.filter(inDecade).length) : style ? Math.max(1, ordered.filter((s) => matchesStyle(s, style)).length) : ordered.length;
  const head = ordered.slice(0, best);
  const rotated = [...head.slice(shift % head.length), ...head.slice(0, shift % head.length), ...ordered.slice(best)];
  return rotated.slice(0, max);
}

/** Songs whose credits name this artist (the catalogue search also returns songs that only mention them). */
export function byArtist(songs: Song[], name: string): Song[] {
  const want = name.trim().toLowerCase();
  if (!want) return [];
  return songs.filter((s) => s.artists.some((a) => a.name.trim().toLowerCase() === want) || s.subtitle.toLowerCase().includes(want));
}
