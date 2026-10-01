import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ArtistRef, Song } from '@/types';
import { albumPath, artistPath, extractId } from '@/utils/slug';
import { useCanonicalRedirect, useJsonLd } from '@/hooks/useSeo';
import { buildArtistBreadcrumbs, buildArtistJsonLd } from '@/utils/schema';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useArtist, useInfiniteArtistSongs } from '@/features/artists/useArtist';
import { usePlayerStore } from '@/store/playerStore';
import { playAlbum } from '@/features/player/playEntity';
import { SongRow } from '@/components/SongRow';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { ShuffleIcon } from '@/components/Icons';
import { EntityAction, EntityHeader, EntityMenu, EntityMeta, PlayFab } from '@/components/EntityHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { shuffled } from '@/features/library/sort';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SaveButton } from '@/components/SaveButton';
import { AdSlot } from '@/components/AdSlot';

export default function ArtistPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: artist, isLoading, isError, refetch } = useArtist(id);
  const topSongs = useInfiniteArtistSongs(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const [showAll, setShowAll] = useState(false);
  const canonicalPath = artist ? artistPath(artist) : undefined;
  useCanonicalRedirect(canonicalPath);
  usePageMeta({
    title: artist ? `${artist.name} Songs — Hits & Latest` : undefined,
    description: artist
      ? `Play ${artist.name} songs free on VinaX — top hits, latest releases and albums. No login, private by design.`
      : undefined,
    image: artist ? bestImage(artist.images, 500) : undefined,
    type: 'profile',
    canonicalPath,
  });
  useJsonLd(artist && [buildArtistJsonLd(artist), buildArtistBreadcrumbs(artist)]);

  if (isLoading) return <div className="max-w-screen-xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !artist) return <ErrorState retry={() => refetch()} />;

  const paged = topSongs.data?.pages.flat() ?? [];
  const seen = new Set<string>();
  const songs = (paged.length ? paged : artist.topSongs).filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const art = bestImage(artist.images, 500);
  const shown = showAll ? songs : songs.slice(0, POPULAR_PREVIEW);
  // Short releases (one to three tracks) read as singles; the rest as albums.
  const singles = artist.albums.filter((a) => a.songCount != null && a.songCount <= 3);
  const albums = artist.albums.filter((a) => !singles.includes(a));
  const related = relatedArtists(artist.id, songs);
  const shufflePlay = () => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(songs), 0);
  };

  return (
    <div className="vx-entity">
      {/* 9.0 — the shared Encore header; a person gets a circle. */}
      <EntityHeader
        kind="Artist"
        title={artist.name}
        titleText={artist.name}
        round
        artUrl={art}
        art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" data-deter-context />}
        meta={
          <EntityMeta
            items={[
              artist.subtitle && artist.subtitle !== 'Artist' ? artist.subtitle[0].toUpperCase() + artist.subtitle.slice(1) : null,
              artist.albums.length ? `${artist.albums.length} release${artist.albums.length === 1 ? '' : 's'}` : null,
            ]}
          />
        }
        actions={
          <>
            {songs.length > 0 && <PlayFab size="lg" label="Play top songs" onClick={() => playQueue(songs, 0)} />}
            {songs.length > 0 && <EntityAction label="Shuffle play" onClick={shufflePlay}><ShuffleIcon /></EntityAction>}
            <SaveButton className="vx-ehead-pill vx-follow" entity={{ id: artist.id, kind: 'artist', title: artist.name, subtitle: 'Artist', image: bestImage(artist.images, 300) }} />
            <EntityMenu items={[songs.length > 0 && { label: 'Start AI Radio', onSelect: () => startRadio(songs[0], { seeds: songs.slice(1, 5) }) }]} />
          </>
        }
      />

      {songs.length > 0 && (
        <section className="vx-esection" aria-label="Popular">
          <SectionHeader title="Popular" />
          <div className="vx-tracklist">
            {shown.map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} />)}
          </div>
          {showAll && (
            <InfiniteSentinel
              onVisible={() => topSongs.hasNextPage && !topSongs.isFetchingNextPage && topSongs.fetchNextPage()}
              disabled={!topSongs.hasNextPage}
              loading={topSongs.isFetchingNextPage}
            />
          )}
          {songs.length > POPULAR_PREVIEW && (
            <button type="button" className="vx-quiet-btn vx-show-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show less' : 'Show more'}
            </button>
          )}
        </section>
      )}
      {topSongs.isLoading && songs.length === 0 && <ListSkeleton />}

      <div className="vx-esection">
        {albums.length > 0 && (
          <Shelf title="Albums">
            {albums.map((a) => (
              <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={[a.year, 'Album'].filter(Boolean).join(' · ')} onPlay={() => void playAlbum(a.id, a.title)} />
            ))}
          </Shelf>
        )}
        {singles.length > 0 && (
          <Shelf title="Singles and EPs">
            {singles.map((a) => (
              <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={[a.year, a.songCount === 1 ? 'Single' : 'EP'].filter(Boolean).join(' · ')} onPlay={() => void playAlbum(a.id, a.title)} />
            ))}
          </Shelf>
        )}
        {related.length > 0 && (
          <Shelf title="Related artists">
            {related.map((a) => (
              <MediaCard key={a.id} to={artistPath(a)} image={a.image || FALLBACK_ART} title={a.name} subtitle="Artist" round />
            ))}
          </Shelf>
        )}
      </div>

      {artist.bio && (
        <section className="vx-esection" aria-label={`About ${artist.name}`}>
          <SectionHeader title="About" />
          <p className="vx-artist-bio line-clamp-[12]">{artist.bio}</p>
        </section>
      )}
      <AdSlot className="vx-esection" />
    </div>
  );
}

const POPULAR_PREVIEW = 5;

/** Other lead artists credited on this artist's songs, most frequent first. */
function relatedArtists(selfId: string, songs: Song[]): ArtistRef[] {
  const count = new Map<string, { ref: ArtistRef; n: number }>();
  for (const song of songs) {
    for (const a of song.artists) {
      if (!a.id || a.id === selfId) continue;
      const hit = count.get(a.id);
      if (hit) hit.n += 1;
      else count.set(a.id, { ref: a, n: 1 });
    }
  }
  return [...count.values()].sort((x, y) => y.n - x.n).slice(0, 12).map((x) => x.ref);
}
