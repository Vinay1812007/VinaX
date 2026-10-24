import { useEffect, useRef } from 'react';
import { currentAccount, onAccountChange } from '@/services/auth/google';
import { useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSocialStore } from '@/features/social/store';
import { checkReleases } from '@/features/releases/releaseWatch';

/**
 * 15.0 — keeps the social layer current while the app runs: loads the own
 * profile and the following list after sign-in, sends the digest when the
 * profile exists (every 30 minutes, and when favourites change), and the
 * playing song while sharing is on. Renders nothing. Signed out: nothing
 * is sent and the stored copy stays until the next sign-in refreshes it.
 */
export function SocialBridge(): null {
  const song = useCurrentSong();
  const favCount = useLibraryStore((s) => s.favorites.length);
  const profile = useSocialStore((s) => s.profile);
  const shareNow = !!profile?.public && !!profile.shareNow;
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

  return null;
}
