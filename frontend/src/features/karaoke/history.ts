/**
 * Package D10 — karaoke session history, purely for delight. Every song you
 * open in Karaoke is remembered locally (capped, deduped, newest first) so the
 * page can offer "Sing again" — one tap back into a favourite session. Rides
 * the KEYS registry, so profile export/import and "erase everything" cover it.
 */
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';

export interface KaraokeSession {
  song: Song;
  at: number;
}

const CAP = 12;

export function loadKaraokeHistory(): KaraokeSession[] {
  const raw = getLocal<KaraokeSession[]>(KEYS.karaoke, []);
  return Array.isArray(raw) ? raw.filter((s) => s && s.song && typeof s.song.id === 'string') : [];
}

/** Record a session (newest first, dedupe by song, cap). Called when Karaoke
 *  opens with a song — repeat opens of the same song just refresh its stamp. */
export function recordKaraokeSession(song: Song): void {
  if (!song?.id) return;
  const rest = loadKaraokeHistory().filter((s) => s.song.id !== song.id);
  setLocal(KEYS.karaoke, [{ song, at: Date.now() }, ...rest].slice(0, CAP));
}
