/**
 * v5.17.0 — "Copy as text" / "Share as text" for a collection. Emits one line
 * per song as "Title — Artist", which is exactly what Library → Import from
 * text parses back, so a list can round-trip through any chat or note.
 */
import type { Song } from '@/types';
import { primaryArtist } from './duplicates';

export function songLine(song: Song): string {
  const artist = primaryArtist(song);
  return artist ? `${song.title} — ${artist}` : song.title;
}

export function collectionToText(songs: Song[]): string {
  return songs.map(songLine).join('\n');
}

/** Clipboard write with a graceful "not available" result instead of a throw. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function canShareText(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Returns false when sharing is unavailable or the user dismissed the sheet. */
export async function shareText(title: string, text: string): Promise<boolean> {
  if (!canShareText()) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
  }
}
