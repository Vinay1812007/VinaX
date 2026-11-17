import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore, type SavedEntity } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useReleaseStore, checkReleases, MAX_ARTISTS } from '@/features/releases/releaseWatch';
import { playArtist } from '@/features/player/playEntity';
import { getArtistTopSongs } from '@/services/api/saavn';
import { EntityHeader, EntityMeta, GlyphCover, PlayFab } from '@/components/EntityHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { UsersIcon } from '@/components/Icons';
import { artistPath } from '@/utils/slug';
import { letterAvatar } from '@/utils/avatar';
import { relativeTime } from '@/utils/format';
import { toast } from '@/store/toastStore';
import { Tabs } from '@/components/ui/Tabs';
import { useSocialStore } from '@/features/social/store';
import { PeopleYouFollow } from '@/features/social/PeopleYouFollow';
import type { Song } from '@/types';
import '@/styles/pages/secondary.css';

/** How many followed artists get a "latest" block (one catalogue read each). */
const LATEST_ARTISTS = 8;
const LATEST_SONGS = 5;

type FollowingTab = 'artists' | 'people';

/**
 * /following: Artists and People. `?tab=people` opens People (Settings →
 * Profile links there): the listeners you follow, features/social/PeopleYouFollow.
 */
export default function FollowingPage() {
  const [params, setParams] = useSearchParams();
  const tab: FollowingTab = params.get('tab') === 'people' ? 'people' : 'artists';
  usePageTitle(tab === 'people' ? 'People you follow' : 'Following');
  const artistCount = useLibraryStore((s) => s.saved.filter((e) => e.kind === 'artist').length);
  const peopleCount = useSocialStore((s) => (Array.isArray(s.following) ? s.following.length : 0));
  const items = [
    { id: 'artists' as const, label: 'Artists', count: artistCount || undefined },
    { id: 'people' as const, label: 'People', count: peopleCount || undefined },
  ];
  return (
    <div>
      <Tabs items={items} value={tab} onChange={(t) => setParams(t === 'people' ? { tab: 'people' } : {}, { replace: true })} label="Following" idPrefix="following" className="mt-2 mb-4" />
      <div role="tabpanel" id={`following-panel-${tab}`} aria-labelledby={`following-tab-${tab}`}>
        {tab === 'people' ? <PeopleYouFollow /> : <ArtistsYouFollow />}
      </div>
    </div>
  );
}

/**
 * 1.12 — /following → Artists: the artists you follow (Follow on an artist page), in
 * one place. Newest songs from them first — the release alerts the app
 * already keeps (features/releases) — then the current top songs of each
 * artist, so there is always something to play even before a release lands.
 * Everything is worked out on the device from the saved artists; no server.
 */
function ArtistsYouFollow() {
  const saved = useLibraryStore((s) => s.saved);
  const artists = useMemo(() => saved.filter((e) => e.kind === 'artist').sort((a, b) => b.savedAt - a.savedAt), [saved]);
  const fresh = useReleaseStore((s) => s.fresh);
  const checkedAt = useReleaseStore((s) => s.checkedAt);
  const dismiss = useReleaseStore((s) => s.dismiss);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [checking, setChecking] = useState(false);
  const feed = useMemo(() => [...fresh].sort((a, b) => b.at - a.at), [fresh]);
  const feedSongs = useMemo(() => feed.map((f) => f.song), [feed]);
  const latestIds = artists.slice(0, LATEST_ARTISTS).map((a) => a.id).join(',');
  const latest = useQuery({
    queryKey: ['following-latest', latestIds],
    queryFn: async () => {
      const out: Array<{ artist: SavedEntity; songs: Song[] }> = [];
      for (const artist of artists.slice(0, LATEST_ARTISTS)) {
        const songs = await getArtistTopSongs(artist.id).catch(() => [] as Song[]);
        if (songs.length) out.push({ artist, songs: songs.slice(0, LATEST_SONGS) });
      }
      return out;
    },
    enabled: artists.length > 0,
    staleTime: 30 * 60_000,
  });

  const checkNow = async (): Promise<void> => {
    setChecking(true);
    try {
      const n = await checkReleases(true);
      toast(n ? `${n} new song${n === 1 ? '' : 's'} from your artists` : 'Nothing new yet — checked just now');
    } catch {
      toast('Could not check right now');
    } finally {
      setChecking(false);
    }
  };

  if (!artists.length) {
    return (
      <EmptyState
        title="You follow nobody yet"
        message="Press Follow on an artist’s page and their new songs land here, with a notification on Android. Top Artists is a good place to start."
        action={<Link to="/top-artists" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Top Artists</Link>}
      />
    );
  }

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Following"
        title="Artists you follow"
        art={<GlyphCover tone="smart" icon={<UsersIcon />} />}
        meta={<EntityMeta items={[`${artists.length} artist${artists.length === 1 ? '' : 's'}`, feed.length ? `${feed.length} new song${feed.length === 1 ? '' : 's'}` : null, checkedAt ? `checked ${relativeTime(checkedAt)}` : null, artists.length > MAX_ARTISTS ? `new songs are checked for the first ${MAX_ARTISTS}` : null]} />}
        actions={
          <>
            {feedSongs.length > 0 && <PlayFab size="lg" label="Play new songs" onClick={() => playQueue(feedSongs, 0)} />}
            <button type="button" onClick={() => void checkNow()} disabled={checking} className="vx-tap px-5 min-h-[44px] rounded-full btn-secondary font-semibold disabled:opacity-60">
              {checking ? 'Checking…' : 'Check for new songs'}
            </button>
          </>
        }
      />

      <Shelf title="Your artists" explanation="Tap to open, or press play for a mix of theirs.">
        {artists.map((a) => (
          <MediaCard key={a.id} to={artistPath({ id: a.id, name: a.title })} image={a.image || letterAvatar(a.title)} title={a.title} subtitle={a.subtitle || 'Artist'} round onPlay={() => void playArtist(a.id, a.title)} />
        ))}
      </Shelf>

      <section className="vx-sec-block" aria-label="New from your artists">
        <SectionHeader title="New from your artists" explanation={feed.length ? 'This year’s songs that appeared since you followed them, newest first.' : 'Nothing new since the last check. New songs show here once the catalogue lists them, usually within a day of release.'} />
        {feed.length > 0 && (
          <div className="vx-group">
            {feed.map((f, i) => (
              <div key={f.song.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0"><SongRow song={f.song} songs={feedSongs} index={i} /></div>
                <span className="text-[12px] font-semibold text-ink-400 shrink-0 hidden sm:inline">{relativeTime(f.at)}</span>
                <button type="button" onClick={() => dismiss(f.song.id)} aria-label={`Dismiss ${f.song.title}`} className="vx-tap px-3 min-h-[36px] rounded-full text-[13px] font-semibold text-ink-300">Dismiss</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {latest.isLoading && <p className="text-ink-400 text-[14px] px-1">Looking up their latest…</p>}
      {(latest.data ?? []).map(({ artist, songs }) => (
        <section key={artist.id} className="vx-sec-block" aria-label={`Latest from ${artist.title}`}>
          <SectionHeader title={artist.title} explanation="Their top songs right now." seeAllTo={artistPath({ id: artist.id, name: artist.title })} />
          <div className="vx-group">
            {songs.map((s, i) => <SongRow key={s.id} song={s} songs={songs} index={i} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
