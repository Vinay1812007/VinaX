/**
 * 15.0 — the social layer on the device: the listener's own public profile
 * (opt-in), who they follow, and the digest the app sends with it.
 *
 * What leaves the device, and only while "Public profile" is on: a handle, a
 * line, up to ten top artists, three languages and twenty recent likes, plus
 * the playing song while "Share what I'm playing" is on (refreshed every few
 * minutes). The digest is built from the on-device taste profile and
 * favourites; the server stores it as sent (nothing is computed there).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { loadProfile } from '@/services/personalization/storage';
import { useLibraryStore } from '@/store/libraryStore';
import { deleteMyProfile, getFollowing, getMyProfile, liteSong, putMyProfile, setFollow, type ProfileWrite, type PublicProfile } from '@/services/social/api';

export interface SocialState {
  profile: PublicProfile | null;
  following: PublicProfile[];
  loadedAt: number;
  followingAt: number;
  digestAt: number;
  nowAt: number;
  busy: boolean;
  error: string | null;
  /** Fetch the own profile and the following list (cheap; cached a few minutes). */
  refresh(force?: boolean): Promise<void>;
  save(patch: ProfileWrite): Promise<PublicProfile | null>;
  remove(): Promise<void>;
  follow(handle: string, on: boolean): Promise<boolean>;
  /** Send the digest if the profile exists and the last send is old. */
  pushDigest(force?: boolean): Promise<void>;
  /** Send the playing song (or clear it) while sharing is on. */
  pushNow(song: Song | null): Promise<void>;
}

export const DIGEST_EVERY_MS = 30 * 60_000;
export const NOW_EVERY_MS = 3 * 60_000;
export const REFRESH_EVERY_MS = 5 * 60_000;

/** The digest from the taste profile and favourites. Pure. */
export function buildDigest(favorites: Song[], profile = loadProfile()): NonNullable<ProfileWrite['summary']> {
  const artists = topArtists(profile, 10).map((a) => ({ name: a.affinity.name, plays: a.affinity.plays }));
  const langs = topLanguages(profile, 3);
  const total = langs.reduce((n, l) => n + Math.max(0, l.affinity.score), 0) || 1;
  return {
    topArtists: artists,
    topLanguages: langs.map((l) => ({ id: l.id, pct: Math.round((Math.max(0, l.affinity.score) / total) * 100) })),
    recentLikes: favorites.slice(0, 20).map(liteSong),
  };
}

export const useSocialStore = create<SocialState>()(
  persist(
    (set, get) => ({
      profile: null,
      following: [],
      loadedAt: 0,
      followingAt: 0,
      digestAt: 0,
      nowAt: 0,
      busy: false,
      error: null,
      refresh: async (force = false) => {
        if (!force && Date.now() - get().loadedAt < REFRESH_EVERY_MS) return;
        set({ busy: true, error: null });
        try {
          const [profile, following] = await Promise.all([getMyProfile(), getFollowing().catch(() => get().following ?? [])]);
          set({ profile, following, loadedAt: Date.now(), followingAt: Date.now(), busy: false });
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : 'error' });
        }
      },
      save: async (patch) => {
        set({ busy: true, error: null });
        try {
          const profile = await putMyProfile(patch);
          set({ profile, busy: false, loadedAt: Date.now() });
          return profile;
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : 'error' });
          return null;
        }
      },
      remove: async () => {
        set({ busy: true, error: null });
        try {
          await deleteMyProfile();
          set({ profile: null, following: [], busy: false, digestAt: 0, nowAt: 0 });
        } catch (e) {
          set({ busy: false, error: e instanceof Error ? e.message : 'error' });
        }
      },
      follow: async (handle, on) => {
        try {
          const following = await setFollow(handle, on);
          // Re-read the list so the new friend's digest arrives.
          const list = await getFollowing().catch(() => get().following.filter((p) => on || p.handle !== handle));
          set({ following: list, followingAt: Date.now() });
          return following;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'error' });
          return !on;
        }
      },
      pushDigest: async (force = false) => {
        const p = get().profile;
        if (!p || (!force && Date.now() - get().digestAt < DIGEST_EVERY_MS)) return;
        try {
          const profile = await putMyProfile({ summary: buildDigest(useLibraryStore.getState().favorites) });
          set({ profile, digestAt: Date.now() });
        } catch {
          /* next time */
        }
      },
      pushNow: async (song) => {
        const p = get().profile;
        if (!p || !p.public) return;
        if (song && Date.now() - get().nowAt < NOW_EVERY_MS) return;
        try {
          const profile = await putMyProfile({ nowPlaying: song ? liteSong(song) : null });
          set({ profile, nowAt: song ? Date.now() : 0 });
        } catch {
          /* next time */
        }
      },
    }),
    {
      name: KEYS.social,
      partialize: (s) => ({ profile: s.profile, following: s.following, digestAt: s.digestAt }),
      // A stored copy from storage is untrusted too: the list is always an array.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SocialState>;
        return { ...current, ...p, following: Array.isArray(p.following) ? p.following : [], profile: p.profile && typeof p.profile === 'object' && typeof p.profile.handle === 'string' ? p.profile : null };
      },
    },
  ),
);
