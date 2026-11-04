/**
 * Schema 11 — pinned search results, set from the owner console (Search
 * Insights → "Pin a song…"). When the words someone searches for are exactly
 * a pinned query, that song leads the results. The client bundle carries them
 * as `searchPins: { "<words>": { id, title, artist?, image? } }`.
 *
 * Imported only by the Search page (a lazy route), never by the app shell.
 */
import type { Song } from '@/types';

export interface SearchPin {
  id: string;
  title: string;
  artist?: string;
  image?: string;
}
export type SearchPins = Record<string, SearchPin>;

/** The words as the console stores them: lower case, single spaces, at most 80 characters. */
export function pinKey(q: string): string {
  return q.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80).trim();
}

/** The pin for these words, if any — own entries with an id only (never the object prototype). */
export function pinFor(pins: SearchPins | null | undefined, q: string): SearchPin | null {
  if (!pins || typeof pins !== 'object') return null;
  const key = pinKey(q);
  if (key.length < 2 || !Object.prototype.hasOwnProperty.call(pins, key)) return null;
  const pin = pins[key];
  return pin && typeof pin === 'object' && typeof pin.id === 'string' && pin.id ? pin : null;
}

/** `songs` with `pinned` first; a copy of it already in the list moves up instead of showing twice. */
export function withPinnedFirst(songs: Song[], pinned: Song | null | undefined): Song[] {
  if (!pinned) return songs;
  if (songs[0]?.id === pinned.id) return songs;
  const lead = songs.find((s) => s.id === pinned.id) ?? pinned;
  return [lead, ...songs.filter((s) => s.id !== pinned.id)];
}
