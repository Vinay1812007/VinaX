import { Link, useParams } from 'react-router-dom';
import { albumPath, artistPath, extractId } from '@/utils/slug';
import { useCanonicalRedirect, useJsonLd } from '@/hooks/useSeo';
import { buildAlbumBreadcrumbs, buildAlbumJsonLd } from '@/utils/schema';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAlbum } from '@/features/albums/useAlbum';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMenu, EntityMeta, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { shuffled } from '@/features/library/sort';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { ShareIcon, ShuffleIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SaveButton } from '@/components/SaveButton';
import { shareLink } from '@/utils/share';
import { languageLabel } from '@/constants/languages';
import { AdSlot } from '@/components/AdSlot';

export default function AlbumPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: album, isLoading, isError, refetch } = useAlbum(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);
  const canonicalPath = album ? albumPath(album) : undefined;
  useCanonicalRedirect(canonicalPath);
  usePageMeta({
    title: album ? `${album.title}${album.year ? ` (${album.year})` : ''} — Album` : undefined,
    description: album
      ? `Listen to ${album.title}${album.year ? ` (${album.year})` : ''} — ${album.songCount ?? album.songs.length} songs free on VinaX. No login, private by design.`
      : undefined,
    image: album ? bestImage(album.images, 500) : undefined,
    type: 'music.album',
    canonicalPath,
  });
  useJsonLd(album && [buildAlbumJsonLd(album), buildAlbumBreadcrumbs(album)]);

  if (isLoading) return <div className="max-w-screen-xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !album) return <ErrorState retry={() => refetch()} />;

  const art = bestImage(album.images, 500);
  const artist = album.artists[0];
  const shufflePlay = () => {
    if (!album.songs.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(album.songs), 0);
  };

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Album"
        title={album.title}
        titleText={album.title}
        artUrl={art}
        art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" data-deter-context />}
        meta={
          <EntityMeta
            items={[
              artist?.id ? <Link to={artistPath(artist)}>{album.subtitle || artist.name}</Link> : album.subtitle,
              album.year,
              album.language && languageLabel(album.language),
              (album.songCount ?? album.songs.length) ? songsLabel(album.songCount ?? album.songs.length) : null,
              totalDuration(album.songs),
            ]}
          />
        }
        actions={
          <>
            {album.songs.length > 0 && <PlayFab size="lg" label="Play all" onClick={() => playQueue(album.songs, 0)} />}
            {album.songs.length > 0 && (
              <EntityAction label="Shuffle play" onClick={shufflePlay}><ShuffleIcon /></EntityAction>
            )}
            <SaveButton variant="icon" entity={{ id: album.id, kind: 'album', title: album.title, subtitle: album.subtitle, image: bestImage(album.images, 300) }} />
            <EntityAction label="Share" onClick={() => void shareLink(albumPath(album), album.title)}><ShareIcon /></EntityAction>
            <EntityMenu
              items={[album.songs.length > 0 && { label: 'Add to queue', onSelect: () => enqueueAll(album.songs) }]}
            />
          </>
        }
      />
      {album.songs.length === 0 ? (
        <EmptyState title="Track list unavailable" message="We couldn’t load this album’s tracks right now. Please try again in a moment." />
      ) : (
        <div className="vx-tracklist no-album">
          <TrackListHead />
          {album.songs.map((song, i) => <SongRow key={song.id} song={song} songs={album.songs} index={i} showArt={false} />)}
        </div>
      )}
      <AdSlot className="vx-esection" />
    </div>
  );
}
