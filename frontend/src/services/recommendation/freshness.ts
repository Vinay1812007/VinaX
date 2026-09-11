import type { Song } from '@/types';
import { isJunkTitle, songKey } from './flow';

/** One admission gate for radio, AI and emergency queue top-ups. */
export function freshSongs(
  songs: Song[],
  options: {
    excludeIds?: Set<string>;
    excludeKeys?: Set<string>;
    language?: string | null;
    muted?: string[];
    blocked?: (song: Song) => boolean;
  } = {},
): Song[] {
  const ids = new Set(options.excludeIds);
  const keys = new Set(options.excludeKeys);
  return songs.filter((song) => {
    if (!song?.id || !song.title || isJunkTitle(song.title)) return false;
    if (song.duration != null && song.duration > 0 && song.duration < 90) return false;
    if (song.language && options.muted?.includes(song.language)) return false;
    if (options.language && song.language !== options.language) return false;
    if (options.blocked?.(song)) return false;
    const key = songKey(song);
    if (ids.has(song.id) || keys.has(key)) return false;
    ids.add(song.id);
    keys.add(key);
    return true;
  });
}
