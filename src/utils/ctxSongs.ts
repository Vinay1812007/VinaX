import type { Song } from '@/types';

/**
 * Right-click context registry: song rows/cards tag themselves with
 * `data-song-id` and drop their Song object here so the custom context menu
 * can act on whatever was under the pointer without threading props through
 * every list. Tiny LRU keeps memory flat on endless feeds.
 */
const map = new Map<string, Song>();
const CAP = 500;

export function rememberCtxSong(song: Song): void {
  if (!song?.id) return;
  if (map.has(song.id)) map.delete(song.id);
  map.set(song.id, song);
  if (map.size > CAP) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

export function recallCtxSong(id: string | undefined | null): Song | undefined {
  return id ? map.get(id) : undefined;
}
