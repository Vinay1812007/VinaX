/**
 * 15.0 — the social layer on the device: the listener's own public profile
 * (opt-in), who they follow, and the digest the app sends with it.
 *
 * What leaves the device, and only while "Public profile" is on: a handle, a
 * line, up to ten top artists, three languages and twenty recent likes, plus
 * the playing song while "Share what I'm playing" is on (refreshed every few
 * minutes). The digest is built from the on-device taste profile and
 * favourites; the server stores it as sent (nothing is computed there).
 *
 * v23 — "Let people I follow join my room" (off by default): while this
 * listener hosts Listen Together, the room's code and host token go to the
 * server, which checks the token against the room and shows the code only to
 * people who follow each other with this listener, only while the room is live.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { loadProfile } from '@/services/personalization/storage';
import { useLibraryStore } from '@/store/libraryStore';
import { deleteMyProfile, getFollowing, getMyProfile, liteSong, putMyProfile, setFollow, SocialError, type ProfileWrite, type PublicProfile } from '@/services/social/api';

export interface SocialState {
  profile: PublicProfile | null;
  following: PublicProfile[];
  loadedAt: number;
  followingAt: number;
  digestAt: number;
  nowAt: number;
  /** v23 — the room code last sent with the profile (null: none, or cleared), and when. Not persisted. */
  jamSent: string | null;
  jamAt: number;
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
  /** v23 — send the room this device hosts (or clear it) while "Let people I follow join my room" is on. */
  pushJam(jam: { code: string; hostToken: string } | null): Promise<void>;
}

export const DIGEST_EVERY_MS = 30 * 60_000;
export const NOW_EVERY_MS = 3 * 60_000;
export const REFRESH_EVERY_MS = 5 * 60_000;
/** v23 — while hosting, the room is sent again this often (the server's sweep forgets a code idle for 15 minutes). */
export const JAM_EVERY_MS = 5 * 60_000;

/** v23 — the list without room codes (for anything kept rather than just fetched). Always an array. */
export function withoutJams(list: unknown): PublicProfile[] {
  if (!Array.isArray(list)) return [];
  return (list as PublicProfile[]).map((p) => {
    if (!p || typeof p !== 'object' || !('jamCode' in p)) return p;
    const { jamCode: _drop, ...rest } = p;
    void _drop;
    return rest;
  });
}

/** The digest from the taste profile and favourites. Pure. (2.0 — badges are gone, so none are sent.) */
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
      jamSent: null,
      jamAt: 0,
      busy: false,
      error: null,
      refresh: async (force = false) => {
        if (!force && Date.now() - get().loadedAt < REFRESH_EVERY_MS) return;
        set({ busy: true, error: null });
        try {
          // A list kept from before is shown without room codes: a code is only ever as fresh as the server's answer.
          const [profile, following] = await Promise.all([getMyProfile(), getFollowing().catch(() => withoutJams(get().following))]);
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
          // The switch off: the server dropped the room code.
          if (patch.shareJam === false) set({ jamSent: null, jamAt: 0 });
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
          set({ profile: null, following: [], busy: false, digestAt: 0, nowAt: 0, jamSent: null, jamAt: 0 });
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
      pushJam: async (jam) => {
        const p = get().profile;
        if (!p) return;
        const sent = get().jamSent;
        if (jam) {
          if (!p.shareJam) return;
          // Half the period: the bridge's timer fires a little under JAM_EVERY_MS after the last send landed.
          if (sent === jam.code && Date.now() - get().jamAt < JAM_EVERY_MS / 2) return;
        } else if (!sent) return;
        try {
          const profile = await putMyProfile({ jam });
          set({ ...(profile ? { profile } : {}), jamSent: jam?.code ?? null, jamAt: Date.now() });
        } catch (e) {
          // The room is over (409) or not this device's (403): not asked again
          // until the next send is due. Anything else: the next change tries again.
          if (e instanceof SocialError && (e.status === 409 || e.status === 403)) set({ jamSent: jam?.code ?? null, jamAt: Date.now() });
        }
      },
    }),
    {
      name: KEYS.social,
      // v23 — room codes are never stored: a code from an earlier visit may lead to a room that is over.
      partialize: (s) => ({ profile: s.profile, following: withoutJams(s.following), digestAt: s.digestAt }),
      // A stored copy from storage is untrusted too: the list is always an array.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SocialState>;
        return { ...current, ...p, following: withoutJams(p.following), profile: p.profile && typeof p.profile === 'object' && typeof p.profile.handle === 'string' ? p.profile : null };
      },
    },
  ),
);
