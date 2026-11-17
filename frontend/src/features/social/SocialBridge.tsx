import { useEffect, useRef } from 'react';
import { currentAccount, onAccountChange } from '@/services/auth/google';
import { useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { JAM_EVERY_MS, useSocialStore } from '@/features/social/store';
import { checkReleases } from '@/features/releases/releaseWatch';
import { useTogether } from '@/services/together/session';
import { hostTokenFor } from '@/services/together';

/**
 * 15.0 — keeps the social layer current while the app runs: loads the own
 * profile and the following list after sign-in, sends the digest when the
 * profile exists (every 30 minutes, and when favourites change), and the
 * playing song while sharing is on. Renders nothing. Signed out: nothing
 * is sent and the stored copy stays until the next sign-in refreshes it.
 * v23: while this device hosts a Listen Together room and "Let people I
 * follow join my room" is on, the room goes with the profile; it is cleared
 * when the session ends.
 */
export function SocialBridge(): null {
  const song = useCurrentSong();
  const favCount = useLibraryStore((s) => s.favorites.length);
  const profile = useSocialStore((s) => s.profile);
  const shareNow = !!profile?.public && !!profile.shareNow;
  const hasProfile = !!profile;
  const shareJam = !!profile?.shareJam;
  const roomMode = useTogether((s) => s.mode);
  const roomCode = useTogether((s) => s.code);
  const signedIn = useRef(!!currentAccount());

  useEffect(() => {
    const load = () => {
      if (!currentAccount()) return;
      void useSocialStore.getState().refresh();
    };
    load();
    const off = onAccountChange((a) => {
      signedIn.current = !!a;
      if (a) void useSocialStore.getState().refresh(true);
    });
    // 15.0 — release alerts for saved artists ride the same open/visible beat.
    const releases = () => { void checkReleases(); };
    setTimeout(releases, 6_000);
    const onVisible = () => { if (document.visibilityState === 'visible') { load(); releases(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { off(); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!signedIn.current || !profile) return;
    const t = setTimeout(() => void useSocialStore.getState().pushDigest(), 4_000);
    return () => clearTimeout(t);
  }, [favCount, profile]);

  useEffect(() => {
    if (!signedIn.current || !shareNow) return;
    const t = setTimeout(() => void useSocialStore.getState().pushNow(song ?? null), 2_500);
    return () => clearTimeout(t);
  }, [song, shareNow]);

  useEffect(() => {
    if (!signedIn.current || !hasProfile) return;
    const code = shareJam && roomMode === 'host' && roomCode ? roomCode : null;
    const send = () => {
      const hostToken = code ? hostTokenFor(code) : null;
      void useSocialStore.getState().pushJam(code && hostToken ? { code, hostToken } : null);
    };
    const t = setTimeout(send, 2_000);
    const iv = code ? setInterval(send, JAM_EVERY_MS) : undefined;
    return () => { clearTimeout(t); if (iv) clearInterval(iv); };
  }, [roomMode, roomCode, shareJam, hasProfile]);

  return null;
}
