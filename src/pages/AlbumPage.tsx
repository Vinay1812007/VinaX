import { useParams } from 'react-router-dom';
import { albumPath, extractId } from '@/utils/slug';
import { useCanonicalRedirect, useJsonLd } from '@/hooks/useSeo';
import { buildAlbumBreadcrumbs, buildAlbumJsonLd } from '@/utils/schema';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAlbum } from '@/features/albums/useAlbum';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { PlayIcon, ShareIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SaveButton } from '@/components/SaveButton';
import { shareLink } from '@/utils/share';
import { languageLabel } from '@/constants/languages';

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

  if (isLoading) return <div className="max-w-4xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !album) return <ErrorState retry={() => refetch()} />;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 mb-8">
        <img src={bestImage(album.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl object-cover shadow-float" data-deter-context />
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">Album</p>
          <h1 className="text-display tracking-tight">{album.title}</h1>
          <p className="text-sm text-ink-300 mt-2">{album.subtitle}</p>
          <p className="text-xs text-ink-400 mt-1">
            {album.year}
            {album.language && <> · {languageLabel(album.language)}</>}
            {album.songCount != null && <> · {album.songCount} songs</>}
          </p>
          <div className="flex gap-2 mt-4">
            {album.songs.length > 0 && (
              <>
                <button onClick={() => playQueue(album.songs, 0)} className="flex items-center gap-2 px-6 min-h-touch rounded-full btn-primary">
                  <PlayIcon className="w-4 h-4" /> Play all
                </button>
                <button onClick={() => enqueueAll(album.songs)} className="px-4 min-h-touch rounded-full btn-secondary text-sm">
                  + Queue
                </button>
              </>
            )}
            <button onClick={() => void shareLink(albumPath(album), album.title)} aria-label="Share" className="p-2.5 rounded-full btn-secondary">
              <ShareIcon className="w-4 h-4" />
            </button>
            <SaveButton entity={{ id: album.id, kind: 'album', title: album.title, subtitle: album.subtitle, image: bestImage(album.images, 300) }} />
          </div>
        </div>
      </div>
      {album.songs.length === 0 ? (
        <EmptyState title="Track list unavailable" message="We couldn’t load this album’s tracks right now. Please try again in a moment." />
      ) : (
        album.songs.map((song, i) => <SongRow key={song.id} song={song} songs={album.songs} index={i} />)
      )}
    </div>
  );
}
