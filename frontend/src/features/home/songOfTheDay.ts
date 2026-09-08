import type { HistoryEntry, Song } from '@/types';

/**
 * v5.17.0 — Song of the day: one pick per calendar date from the union of
 * favourites and songs the listener has finished, seeded by the date string
 * so it stays put all day and changes tomorrow. Pure.
 */
export interface SongOfTheDay {
  song: Song;
  /** One-line reason, e.g. "A favourite from March" / "You finished it 4 times". */
  reason: string;
  isFavorite: boolean;
  completions: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function songOfTheDay(favorites: Song[], entries: HistoryEntry[], dateKey: string): SongOfTheDay | null {
  const favIds = new Set(favorites.map((s) => s.id));
  const completions = new Map<string, number>();
  const firstPlay = new Map<string, number>();
  const pool: Song[] = [];
  const seen = new Set<string>();
  for (const s of favorites) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    pool.push(s);
  }
  for (const e of entries) {
    if (!e?.song?.id || typeof e.ts !== 'number') continue;
    const id = e.song.id;
    const prev = firstPlay.get(id);
    if (prev === undefined || e.ts < prev) firstPlay.set(id, e.ts);
    if (!e.completed) continue;
    completions.set(id, (completions.get(id) ?? 0) + 1);
    if (!seen.has(id)) {
      seen.add(id);
      pool.push(e.song);
    }
  }
  if (!pool.length) return null;
  // Sort by id so the pick does not depend on favourite/history ordering.
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const song = pool[hash(dateKey) % pool.length];
  const isFavorite = favIds.has(song.id);
  const done = completions.get(song.id) ?? 0;
  const first = firstPlay.get(song.id);
  let reason: string;
  if (done >= 2) reason = `You finished it ${done} times`;
  else if (isFavorite && first !== undefined) reason = `A favourite from ${MONTHS[new Date(first).getMonth()]}`;
  else if (isFavorite) reason = 'One of your favourites';
  else reason = 'You finished it once';
  return { song, reason, isFavorite, completions: done };
}
