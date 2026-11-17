import type { Song } from '@/types';
import { albumPath, slugify } from '@/utils/slug';
import { isEpisode } from './episode';

/**
 * 1.3 — podcast routes and the one test that tells an episode from a song.
 * Kept free of API imports so the track menu and the player can use it.
 */

/** `/podcast/talking-music-62` — the page reads the id after the last dash. */
export function podcastPath(p: { id: string; name?: string | null }): string {
  return `/podcast/${p.name ? `${slugify(p.name)}-` : ''}${p.id}`;
}

// The episode test and the resume helpers live in episode.ts (small enough for the first load).
export { EPISODE_PROGRESS_KEY, isEpisode, resumeEvictee } from './episode';

/** Where a song's "album" lives: the podcast page for an episode (its album id is the show's id), the album page otherwise. */
export function collectionPath(song: Song): string | null {
  if (!song.album?.id) return null;
  return isEpisode(song) ? podcastPath(song.album) : albumPath(song.album);
}
