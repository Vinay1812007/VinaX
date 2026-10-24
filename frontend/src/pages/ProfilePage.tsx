import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { EntityHeader, EntityMeta, PlayFab } from '@/components/EntityHeader';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { SectionHeader } from '@/components/SectionHeader';
import { getProfile, SocialError, type PublicProfile } from '@/services/social/api';
import { resolveSongs } from '@/features/social/resolve';
import { useSocialStore } from '@/features/social/store';
import { currentAccount } from '@/services/auth/google';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { recommendFromSeeds } from '@/services/recs/similar';
import { languageLabel } from '@/constants/languages';
import { FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import '@/styles/pages/secondary.css';

/**
 * 15.0 — /u/<handle>: a listener's public profile. Their name and picture,
 * a line, top artists and languages, recent likes (playable), what they
 * are playing when they share it, Follow, and Blend — a mix built on this
 * device from both listeners' likes.
 */
export default function ProfilePage() {
  const { handle = '' } = useParams();
  const own = useSocialStore((s) => s.profile);
  const following = useSocialStore((s) => s.following);
  const mine = !!own && own.handle === handle.toLowerCase();
  const q = useQuery<PublicProfile, SocialError>({ queryKey: ['profile', handle.toLowerCase()], queryFn: () => getProfile(handle), staleTime: 60_000, retry: false, enabled: !!handle });
  const profile = q.data;
  usePageTitle(profile ? `${profile.name ?? profile.handle} — profile` : 'Profile');
  const likes = useQuery({ queryKey: ['profile-likes', handle.toLowerCase(), profile?.updatedAt], queryFn: () => resolveSongs(profile?.recentLikes ?? [], 20), enabled: !!profile?.recentLikes?.length, staleTime: 10 * 60_000 });
  const isFollowing = profile?.following ?? following.some((p) => p.handle === profile?.handle);
  const [toggling, setToggling] = useState(false);

  if (q.isLoading) return <div className="vx-sec"><p className="text-ink-400 p-6">Loading…</p></div>;
  if (!profile) {
    const signedOut = q.error?.code === 'signed_out' || !currentAccount();
    return <EmptyState title="No such profile" message={signedOut ? 'This profile is private, or does not exist. Sign in to see profiles shared with you.' : 'This profile is private, or does not exist.'} action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Home</Link>} />;
  }

  const toggleFollow = async () => {
    if (!currentAccount()) { toast('Sign in to follow listeners'); return; }
    setToggling(true);
    const now = await useSocialStore.getState().follow(profile.handle, !isFollowing);
    setToggling(false);
    toast(now ? `Following ${profile.name ?? profile.handle}` : `Unfollowed ${profile.name ?? profile.handle}`);
    void q.refetch();
  };
  const songs = likes.data ?? [];

  return (
    <div className="vx-sec is-wide">
      <EntityHeader
        kind={mine ? 'Your profile' : 'Listener'}
        title={profile.name ?? `@${profile.handle}`}
        titleText={profile.name ?? profile.handle}
        round
        art={<img src={profile.picture ?? FALLBACK_ART} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-full h-full object-cover" />}
        artUrl={profile.picture ?? undefined}
        description={profile.bio ?? undefined}
        meta={<EntityMeta items={[`@${profile.handle}`, typeof profile.followers === 'number' ? `${profile.followers} follower${profile.followers === 1 ? '' : 's'}` : null, profile.topLanguages[0] ? languageLabel(profile.topLanguages[0].id) : null]} />}
        actions={
          <>
            {songs.length > 0 && <PlayFab label="Play their recent likes" onClick={() => usePlayerStore.getState().playQueue(songs, 0)} />}
            {!mine && (
              <button type="button" onClick={() => void toggleFollow()} disabled={toggling} aria-pressed={!!isFollowing} className={cn('vx-tap px-5 min-h-[44px] rounded-full font-semibold', isFollowing ? 'btn-secondary' : 'btn-primary')}>
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
            {!mine && <BlendButton profile={profile} />}
            {mine && <Link to="/settings#profile" className="vx-tap px-5 min-h-[44px] inline-flex items-center rounded-full btn-secondary font-semibold">Edit</Link>}
          </>
        }
      >
        {profile.nowPlaying && (
          <p className="mt-3 text-[14px] text-ink-300"><span className="vx-np-live-dot" aria-hidden /> Playing now: <span className="font-semibold text-ink-100">{profile.nowPlaying.title}</span>{profile.nowPlaying.subtitle ? ` · ${profile.nowPlaying.subtitle}` : ''}</p>
        )}
      </EntityHeader>

      {profile.topArtists.length > 0 && (
        <section className="vx-sec-block" aria-label="Top artists">
          <SectionHeader title="Top artists" />
          <div className="flex flex-wrap gap-2">
            {profile.topArtists.map((a) => <Link key={a.name} to={`/search/${encodeURIComponent(a.name)}`} className="vx-chip-idle px-4 min-h-[36px] inline-flex items-center text-[14px] font-semibold">{a.name}</Link>)}
          </div>
        </section>
      )}

      {profile.topLanguages.length > 0 && (
        <section className="vx-sec-block" aria-label="Languages">
          <SectionHeader title="Languages" />
          <ul className="vx-group">
            {profile.topLanguages.map((l) => (
              <li key={l.id} className="vx-row">
                <span className="vx-row-main"><span className="vx-row-label">{languageLabel(l.id)}</span></span>
                <span className="text-[13px] font-semibold text-ink-300 tabular-nums">{l.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.recentLikes.length > 0 && (
        <section className="vx-sec-block" aria-label="Recent likes">
          <SectionHeader title="Recent likes" explanation={likes.isLoading ? 'Looking the songs up…' : undefined} />
          {songs.length > 0 && <div className="vx-group">{songs.map((s, i) => <SongRow key={s.id} song={s} songs={songs} index={i} />)}</div>}
        </section>
      )}
    </div>
  );
}

/** Blend: a mix seeded from both listeners' likes, built on this device. */
function BlendButton({ profile }: { profile: PublicProfile }) {
  const [busy, setBusy] = useState(false);
  const favorites = useLibraryStore((s) => s.favorites);
  const seedsTheirs = useMemo(() => profile.recentLikes.slice(0, 3), [profile.recentLikes]);
  const run = async () => {
    setBusy(true);
    try {
      const theirs = await resolveSongs(seedsTheirs, 3);
      const mineSeeds = favorites.slice(0, 2);
      const seeds = [...theirs.slice(0, 3), ...mineSeeds].slice(0, 5);
      if (!seeds.length) { toast('Nothing to blend from yet'); return; }
      const picks = await recommendFromSeeds(seeds, { limit: 20 });
      const mix = [...theirs, ...mineSeeds, ...picks].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
      if (!mix.length) { toast('Could not build the blend right now'); return; }
      usePlayerStore.getState().playQueue(mix, 0, { keepList: true });
      toast(`Blend with ${profile.name ?? profile.handle}: ${mix.length} songs`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={() => void run()} disabled={busy} className="vx-tap px-5 min-h-[44px] rounded-full btn-secondary font-semibold" title="A mix from both of your likes, built on this device">
      {busy ? 'Blending…' : 'Blend'}
    </button>
  );
}
