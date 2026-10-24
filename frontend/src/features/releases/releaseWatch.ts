/**
 * 15.0 — release alerts for the artists a listener saved, worked out on the
 * device. There is no per-listener push on the server (push is broadcast by
 * audience), so the app itself looks: once every 12 hours, for up to 30
 * saved artists, it reads each artist's current top songs from the
 * catalogue and keeps the ids it has seen. A song from this year that was
 * not there before is "new". The first look only seeds the ledger (no
 * alerts for a back catalogue); after that each new song lands in the
 * "New from your artists" shelf on Home, and on Android as a local
 * notification. The catalogue lists top songs by popularity, so a release
 * shows once it has some plays — hours to a day, not the minute it drops.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getArtistTopSongs } from '@/services/api/saavn';
import { isNativePlatform } from '@/services/native';
import { useLibraryStore } from '@/store/libraryStore';

export const CHECK_EVERY_MS = 12 * 60 * 60_000;
export const MAX_ARTISTS = 30;
export const MAX_FRESH = 40;

interface ReleaseState {
  /** artist id → song ids seen in its top list. */
  seen: Record<string, string[]>;
  fresh: Array<{ song: Song; artist: string; at: number }>;
  checkedAt: number;
  dismiss(songId: string): void;
  clear(): void;
}

export const useReleaseStore = create<ReleaseState>()(
  persist(
    (set) => ({
      seen: {},
      fresh: [],
      checkedAt: 0,
      dismiss: (songId) => set((s) => ({ fresh: s.fresh.filter((f) => f.song.id !== songId) })),
      clear: () => set({ fresh: [] }),
    }),
    { name: KEYS.releases },
  ),
);

/** The new songs in `now` for an artist with `before` seen: this year's, unseen. Pure. */
export function findNew(now: Song[], before: string[] | undefined, year = new Date().getFullYear()): Song[] {
  if (!before) return [];
  const seen = new Set(before);
  return now.filter((s) => !seen.has(s.id) && String(s.year ?? '') === String(year));
}

let running = false;

/** Look for new releases if it is time. Safe to call often. */
export async function checkReleases(force = false): Promise<number> {
  const st = useReleaseStore.getState();
  if (running || (!force && Date.now() - st.checkedAt < CHECK_EVERY_MS)) return 0;
  const artists = useLibraryStore.getState().saved.filter((e) => e.kind === 'artist').slice(0, MAX_ARTISTS);
  if (!artists.length) return 0;
  running = true;
  let found = 0;
  try {
    const seen = { ...useReleaseStore.getState().seen };
    const fresh = [...useReleaseStore.getState().fresh];
    const have = new Set(fresh.map((f) => f.song.id));
    let reached = 0;
    for (const a of artists) {
      let songs: Song[];
      try { songs = await getArtistTopSongs(a.id, 0); } catch { continue; }
      reached += 1;
      if (!songs.length) continue;
      const added = findNew(songs, seen[a.id]).filter((s) => !have.has(s.id));
      for (const s of added) { fresh.unshift({ song: s, artist: a.title, at: Date.now() }); have.add(s.id); }
      found += added.length;
      seen[a.id] = [...new Set([...(seen[a.id] ?? []), ...songs.map((s) => s.id)])].slice(-200);
      if (added.length && isNativePlatform()) void notifyLocally(a.title, added);
    }
    // Offline (nothing reached): try again on the next open, not in 12 hours.
    useReleaseStore.setState({ seen, fresh: fresh.slice(0, MAX_FRESH), checkedAt: reached ? Date.now() : st.checkedAt });
  } finally {
    running = false;
  }
  return found;
}

async function notifyLocally(artist: string, songs: Song[]): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    const first = songs[0];
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 2_000_000_000),
        title: `New from ${artist}`,
        body: songs.length === 1 ? first.title : `${first.title} and ${songs.length - 1} more`,
        extra: { link: `/song/${first.id}` },
      }],
    });
  } catch {
    /* no notifications here */
  }
}
