/**
 * 15.0 — release alerts for the artists a listener saved, worked out on the
 * device. There is no per-listener push on the server (push is broadcast by
 * audience), so the app itself looks: once every 12 hours, for up to 30
 * saved artists, it reads each artist's newest songs from the catalogue and
 * keeps the ids it has seen. A song from this year that was not there before
 * is "new". The first look only seeds the ledger (no alerts for a back
 * catalogue); after that each new song lands in the "New from your artists"
 * shelf on Home, and on Android as a local notification.
 *
 * 1.16 — newest first, so a song shows on release day. The VinaX Music API
 * sorts an artist's songs by `sortBy=latest&sortOrder=desc` (measured
 * 2026-11-17: Arijit Singh's newest page is all 2026 songs, while the
 * popular page is mostly older hits). The Worker's built-in fallback (used
 * when the wrapper is down) ignores the sort and answers the top songs with
 * no `total`, so a list without `total` is read as the top songs; when the
 * newest list fails outright, the check asks for the top songs by
 * popularity, as before. Each list seeds the ledger on its own first look
 * (`seeded`), so switching lists never floods the shelf with old songs.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getArtistTopSongs } from '@/services/api/saavn';
import { orchestratedRequest } from '@/services/api/client';
import { normalizeSongList, unwrap } from '@/services/api/normalize';
import { isNativePlatform } from '@/services/native';
import { useLibraryStore } from '@/store/libraryStore';

export const CHECK_EVERY_MS = 12 * 60 * 60_000;
export const MAX_ARTISTS = 30;
export const MAX_FRESH = 40;

/** Which of an artist's song lists a check read. */
export type ReleaseSource = 'latest' | 'top';

interface ReleaseState {
  /** artist id → song ids seen in its newest or top lists. */
  seen: Record<string, string[]>;
  /** artist id → the lists that have seeded `seen`. Missing on ledgers from before 1.16, which only read the top list. */
  seeded?: Record<string, ReleaseSource[]>;
  fresh: Array<{ song: Song; artist: string; at: number }>;
  checkedAt: number;
  dismiss(songId: string): void;
  clear(): void;
}

export const useReleaseStore = create<ReleaseState>()(
  persist(
    (set) => ({
      seen: {},
      seeded: {},
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

/** Whether `source` has seeded the ledger for an artist. Pre-1.16 ledgers were seeded by the top list only. Pure. */
export function isSeeded(st: Pick<ReleaseState, 'seen' | 'seeded'>, artistId: string, source: ReleaseSource): boolean {
  const lists = st.seeded?.[artistId];
  if (lists) return lists.includes(source);
  return source === 'top' && Boolean(st.seen[artistId]);
}

/** An artist's newest songs; `sorted` is false when the answer ignored the sort (no `total`: the Worker's fallback). */
export function getArtistLatestSongs(id: string): Promise<{ songs: Song[]; sorted: boolean }> {
  return orchestratedRequest({
    paths: [`/artists/${encodeURIComponent(id)}/songs?page=0&sortBy=latest&sortOrder=desc`],
    priority: 'background',
    validate: (json) => {
      const d = unwrap(json);
      const list = Array.isArray(d) ? d : Array.isArray(d?.songs) ? d.songs : Array.isArray(d?.results) ? d.results : null;
      if (!list) return null;
      const songs = normalizeSongList(list);
      return songs.length ? { songs, sorted: typeof d?.total === 'number' } : null;
    },
  });
}

/** The newest songs when the catalogue sorted them, else the top songs by popularity. An unsorted answer already is the top list, so it is used as one. */
export async function readArtist(id: string): Promise<{ songs: Song[]; source: ReleaseSource }> {
  const latest = await getArtistLatestSongs(id).catch(() => null);
  if (latest) return { songs: latest.songs, source: latest.sorted ? 'latest' : 'top' };
  return { songs: await getArtistTopSongs(id, 0), source: 'top' };
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
    const seeded = { ...(useReleaseStore.getState().seeded ?? {}) };
    const fresh = [...useReleaseStore.getState().fresh];
    const have = new Set(fresh.map((f) => f.song.id));
    let reached = 0;
    for (const a of artists) {
      let read: { songs: Song[]; source: ReleaseSource };
      try { read = await readArtist(a.id); } catch { continue; }
      reached += 1;
      const { songs, source } = read;
      if (!songs.length) continue;
      const before = isSeeded({ seen, seeded }, a.id, source) ? seen[a.id] : undefined;
      const had: ReleaseSource[] = seeded[a.id] ?? (seen[a.id] ? ['top'] : []);
      const added = findNew(songs, before).filter((s) => !have.has(s.id));
      for (const s of added) { fresh.unshift({ song: s, artist: a.title, at: Date.now() }); have.add(s.id); }
      found += added.length;
      seen[a.id] = [...new Set([...(seen[a.id] ?? []), ...songs.map((s) => s.id)])].slice(-200);
      seeded[a.id] = had.includes(source) ? had : [...had, source];
      if (added.length && isNativePlatform()) void notifyLocally(a.title, added);
    }
    // Offline (nothing reached): try again on the next open, not in 12 hours.
    useReleaseStore.setState({ seen, seeded, fresh: fresh.slice(0, MAX_FRESH), checkedAt: reached ? Date.now() : st.checkedAt });
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
