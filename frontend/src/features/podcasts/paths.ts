import type { Song } from '@/types';
import { albumPath, slugify } from '@/utils/slug';

/**
 * 1.3 — podcast routes and the one test that tells an episode from a song.
 * Kept free of API imports so the track menu and the player can use it.
 */

/** `/podcast/talking-music-62` — the page reads the id after the last dash. */
export function podcastPath(p: { id: string; name?: string | null }): string {
  return `/podcast/${p.name ? `${slugify(p.name)}-` : ''}${p.id}`;
}

/**
 * An episode is a Song whose only audio is the catalogue's `original` file
 * (songs come as 12–320 kbps variants). It survives a reload of the queue,
 * where nothing else marks it.
 */
export function isEpisode(song: Pick<Song, 'audio'>): boolean {
  return song.audio.length > 0 && song.audio.every((a) => a.quality === 'original');
}

/** Where a song's "album" lives: the podcast page for an episode (its album id is the show's id), the album page otherwise. */
export function collectionPath(song: Song): string | null {
  if (!song.album?.id) return null;
  return isEpisode(song) ? podcastPath(song.album) : albumPath(song.album);
}
