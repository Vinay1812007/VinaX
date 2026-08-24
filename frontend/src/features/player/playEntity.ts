import type { Song } from '@/types';
import { getAlbum, getArtist, getArtistTopSongs, getPlaylist } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';

/**
 * One-tap "play this entity" used by card play buttons: fetches the
 * tracklist on demand and replaces the queue. Fault-tolerant — a dead
 * provider produces a toast, never a crash.
 */
function start(songs: Song[], title: string): void {
  if (songs.length === 0) {
    toast('No playable songs found');
    return;
  }
  usePlayerStore.getState().playQueue(songs, 0);
  toast(`Playing ${title}`);
}

export async function playAlbum(id: string, title: string): Promise<void> {
  try {
    const album = await getAlbum(id);
    start(album.songs, title);
  } catch {
    toast('Couldn’t load this album right now');
  }
}

export async function playPlaylist(id: string, title: string): Promise<void> {
  try {
    const playlist = await getPlaylist(id);
    start(playlist.songs, title);
  } catch {
    toast('Couldn’t load this playlist right now');
  }
}

export async function playArtist(id: string, name: string): Promise<void> {
  try {
    let songs = await getArtistTopSongs(id).catch(() => []);
    if (songs.length === 0) {
      songs = (await getArtist(id)).topSongs;
    }
    start(songs, name);
  } catch {
    toast('Couldn’t load this artist right now');
  }
}
