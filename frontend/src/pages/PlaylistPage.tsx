import { useParams } from 'react-router-dom';
import { extractId, playlistPath } from '@/utils/slug';
import { useCanonicalRedirect } from '@/hooks/useSeo';
import { usePageMeta } from '@/hooks/usePageMeta';
import { usePlaylist } from '@/features/playlists/usePlaylist';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { PlayIcon, ShareIcon } from '@/components/Icons';
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

  if (isLoading) return <div className="max-w-4xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !playlist) return <ErrorState retry={() => refetch()} />;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 mb-8">
        <img src={bestImage(playlist.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl object-cover shadow-float" data-deter-context />
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">Playlist</p>
          <h1 className="text-display tracking-tight">{playlist.title}</h1>
          {playlist.subtitle && <p className="text-sm text-ink-300 mt-2">{playlist.subtitle}</p>}
          {playlist.songCount != null && <p className="text-xs text-ink-400 mt-1">{playlist.songCount} songs</p>}
          <div className="flex gap-2 mt-4">
            {playlist.songs.length > 0 && (
              <>
                <button onClick={() => playQueue(playlist.songs, 0)} className="flex items-center gap-2 px-6 min-h-touch rounded-full btn-primary">
                  <PlayIcon className="w-4 h-4" /> Play all
                </button>
                <button onClick={() => enqueueAll(playlist.songs)} className="px-4 min-h-touch rounded-full btn-secondary text-sm">
                  + Queue
                </button>
              </>
            )}
            <button onClick={() => void shareLink(playlistPath(playlist), playlist.title)} aria-label="Share" className="p-2.5 rounded-full btn-secondary">
              <ShareIcon className="w-4 h-4" />
            </button>
            <SaveButton entity={{ id: playlist.id, kind: 'playlist', title: playlist.title, subtitle: playlist.subtitle, image: bestImage(playlist.images, 300) }} />
          </div>
        </div>
      </div>
      {playlist.songs.length === 0 ? (
        <EmptyState title="No songs returned" message="We couldn’t load songs for this playlist right now." />
      ) : (
        playlist.songs.map((song, i) => <SongRow key={`${song.id}-${i}`} song={song} songs={playlist.songs} index={i} />)
      )}
    </div>
  );
}
