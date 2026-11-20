import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { extractId, artistPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useArtist, useInfiniteArtistSongs } from '@/features/artists/useArtist';
import { ARTIST_SONG_SORTS, type ArtistSongSort } from '@/features/artists/sortSongs';
import type { ArtistSongOrder } from '@/services/api/saavn';
import { usePlayerStore, type QueueContext } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { Chip } from '@/components/Chip';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { EntityAction, PlayFab } from '@/components/EntityHeader';
import { ShuffleIcon } from '@/components/Icons';

/** The catalogue's order for each of the page's sort chips. */
const ORDER: Record<ArtistSongSort, ArtistSongOrder> = { popular: 'popularity', newest: 'latest', az: 'alphabetical' };
/** 200 pages of 10: every song of even the biggest catalogues. */
const MAX_PAGES = 200;

/**
 * 1.20.1 — every song by an artist, the way Spotify's "See discography /
 * All songs" works: the artist page shows the top ten, this page lists them
 * all, loading more as the listener scrolls. The catalogue sorts the whole
 * list (Popular, Newest, A–Z), not just the songs loaded so far.
 */
export default function ArtistSongsPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: artist, isLoading, isError, refetch } = useArtist(id);
  const [sort, setSort] = useState<ArtistSongSort>('popular');
  const pages = useInfiniteArtistSongs(id, ORDER[sort], MAX_PAGES);
  const playQueue = usePlayerStore((s) => s.playQueue);
  usePageTitle(artist ? `${artist.name} · All songs` : 'All songs');

  const songs = useMemo(() => {
    const seen = new Set<string>();
    return (pages.data?.pages.flat() ?? []).filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }, [pages.data]);

  if (isLoading) return <div className="max-w-screen-xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !artist) return <ErrorState retry={() => refetch()} />;

  const from: QueueContext = { kind: 'artist', label: artist.name, path: artistPath(artist) };
  return (
    <div className="vx-entity vx-artist-songs">
      <header className="vx-artist-songs-head">
        <Link to={artistPath(artist)} className="vx-artist-songs-back">{artist.name}</Link>
        <h1>All songs</h1>
        <div className="vx-artist-songs-actions">
          {songs.length > 0 && <PlayFab size="lg" label="Play all" onClick={() => playQueue(songs, 0, { from })} />}
          {songs.length > 0 && (
            <EntityAction label="Shuffle play" onClick={() => playQueue(songs, 0, { shuffle: true, from })}>
              <ShuffleIcon />
            </EntityAction>
          )}
        </div>
      </header>
      <div className="vx-chip-rail mb-2" role="group" aria-label="Sort songs">
        {ARTIST_SONG_SORTS.map((o) => (
          <Chip key={o.id} active={sort === o.id} onClick={() => setSort(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
      {pages.isLoading && <ListSkeleton />}
      {!pages.isLoading && songs.length === 0 && <EmptyState title="No songs yet" message="The catalogue has no songs for this artist right now." />}
      <div className="vx-tracklist">
        {songs.map((song, i) => (
          <SongRow key={song.id} song={song} songs={songs} index={i} />
        ))}
      </div>
      <InfiniteSentinel
        onVisible={() => pages.hasNextPage && !pages.isFetchingNextPage && pages.fetchNextPage()}
        disabled={!pages.hasNextPage}
        loading={pages.isFetchingNextPage}
      />
      {!pages.hasNextPage && songs.length > 0 && <p className="vx-artist-songs-end">{songs.length} songs</p>}
    </div>
  );
}
