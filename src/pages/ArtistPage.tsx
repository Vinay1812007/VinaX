import { useParams } from 'react-router-dom';
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
import { PlayIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { SaveButton } from '@/components/SaveButton';

export default function ArtistPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: artist, isLoading, isError, refetch } = useArtist(id);
  const topSongs = useInfiniteArtistSongs(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
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

  if (isLoading) return <div className="max-w-4xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !artist) return <ErrorState retry={() => refetch()} />;

  const paged = topSongs.data?.pages.flat() ?? [];
  const seen = new Set<string>();
  const songs = (paged.length ? paged : artist.topSongs).filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 mb-8">
        <img src={bestImage(artist.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-44 h-44 sm:w-52 sm:h-52 rounded-full object-cover shadow-float" data-deter-context />
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">Artist</p>
          <h1 className="text-display tracking-tight">{artist.name}</h1>
          {songs.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button onClick={() => playQueue(songs, 0)} className="flex items-center gap-2 px-6 min-h-touch rounded-full btn-primary">
                <PlayIcon className="w-4 h-4" /> Play top songs
              </button>
              <button onClick={() => usePlayerStore.getState().startRadio(songs[0])} className="flex items-center gap-2 px-6 min-h-touch rounded-full border border-ink-600 text-ink-100 font-bold hover:bg-ink-800 active:scale-95 transition-transform">
                <PlayIcon className="w-4 h-4" /> Start Radio
              </button>
            </div>
          )}
          <div className="mt-3">
            <SaveButton entity={{ id: artist.id, kind: 'artist', title: artist.name, subtitle: 'Artist', image: bestImage(artist.images, 300) }} />
          </div>
        </div>
      </div>

      {songs.length > 0 && (
        <section className="mb-8">
          <h2 className="text-title mb-1">Songs</h2>
          <p className="text-xs text-ink-400 mb-2">Sorted by popularity — scroll for the full catalog</p>
          {songs.map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} />)}
          <InfiniteSentinel
            onVisible={() => topSongs.hasNextPage && !topSongs.isFetchingNextPage && topSongs.fetchNextPage()}
            disabled={!topSongs.hasNextPage}
            loading={topSongs.isFetchingNextPage}
          />
        </section>
      )}
      {topSongs.isLoading && songs.length === 0 && <ListSkeleton />}

      {artist.albums.length > 0 && (
        <Shelf title="Albums">
          {artist.albums.map((a) => (
            <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={a.year ?? ''} onPlay={() => void playAlbum(a.id, a.title)} />
          ))}
        </Shelf>
      )}

      {artist.bio && (
        <section className="mb-8">
          <h2 className="text-title mb-2">About</h2>
          <p className="text-sm text-ink-300 leading-relaxed whitespace-pre-line line-clamp-[12]">{artist.bio}</p>
        </section>
      )}
    </div>
  );
}
