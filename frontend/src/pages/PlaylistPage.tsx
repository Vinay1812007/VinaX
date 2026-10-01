import { useParams } from 'react-router-dom';
import { extractId, playlistPath } from '@/utils/slug';
import { useCanonicalRedirect } from '@/hooks/useSeo';
import { usePageMeta } from '@/hooks/usePageMeta';
import { usePlaylist } from '@/features/playlists/usePlaylist';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMenu, EntityMeta, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { shuffled } from '@/features/library/sort';
import { languageLabel } from '@/constants/languages';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { ShareIcon, ShuffleIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SaveButton } from '@/components/SaveButton';
import { shareLink } from '@/utils/share';

export default function PlaylistPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: playlist, isLoading, isError, refetch } = usePlaylist(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);
  const canonicalPath = playlist ? playlistPath(playlist) : undefined;
  useCanonicalRedirect(canonicalPath);
  usePageMeta({
    title: playlist ? `${playlist.title} — Playlist` : undefined,
    description: playlist
      ? `Listen to ${playlist.title}${playlist.songCount != null ? ` — ${playlist.songCount} songs` : ''} free on VinaX. No login, private by design.`
      : undefined,
    image: playlist ? bestImage(playlist.images, 500) : undefined,
    type: 'music.playlist',
    canonicalPath,
  });

  if (isLoading) return <div className="max-w-screen-xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !playlist) return <ErrorState retry={() => refetch()} />;

  const art = bestImage(playlist.images, 500);
  const count = playlist.songCount ?? playlist.songs.length;
  const shufflePlay = () => {
    if (!playlist.songs.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(playlist.songs), 0);
  };

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Playlist"
        title={playlist.title}
        titleText={playlist.title}
        artUrl={art}
        art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" data-deter-context />}
        description={playlist.subtitle && !/^\d+\s+songs?$/i.test(playlist.subtitle.trim()) ? playlist.subtitle : undefined}
        meta={
          <EntityMeta
            items={[
              playlist.language && languageLabel(playlist.language),
              count ? songsLabel(count) : null,
              totalDuration(playlist.songs),
            ]}
          />
        }
        actions={
          <>
            {playlist.songs.length > 0 && <PlayFab size="lg" label="Play all" onClick={() => playQueue(playlist.songs, 0)} />}
            {playlist.songs.length > 0 && (
              <EntityAction label="Shuffle play" onClick={shufflePlay}><ShuffleIcon /></EntityAction>
            )}
            <SaveButton variant="icon" entity={{ id: playlist.id, kind: 'playlist', title: playlist.title, subtitle: playlist.subtitle, image: bestImage(playlist.images, 300) }} />
            <EntityAction label="Share" onClick={() => void shareLink(playlistPath(playlist), playlist.title)}><ShareIcon /></EntityAction>
            <EntityMenu
              items={[playlist.songs.length > 0 && { label: 'Add to queue', onSelect: () => enqueueAll(playlist.songs) }]}
            />
          </>
        }
      />
      {playlist.songs.length === 0 ? (
        <EmptyState title="No songs returned" message="We couldn’t load songs for this playlist right now." />
      ) : (
        <div className="vx-tracklist">
          <TrackListHead />
          {playlist.songs.map((song, i) => <SongRow key={`${song.id}-${i}`} song={song} songs={playlist.songs} index={i} />)}
        </div>
      )}
    </div>
  );
}
