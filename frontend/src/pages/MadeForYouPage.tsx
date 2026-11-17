import { useMemo } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { songPath } from '@/utils/slug';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { useShelfSafety } from '@/features/home/useShelfSafety';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { PlayIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/library.css';

export default function MadeForYouPage() {
  usePageTitle('Made for you');
  const { data: raw, isLoading, isError, refetch } = useRecommendations();
  // Mixes stay cached for up to 30 minutes, so a song hidden, an artist set to
  // "Never play", a "show fewer" mute or Kid mode would not reach them until the
  // next rebuild. Filter at render; Play all plays the same filtered list.
  const isSafe = useShelfSafety();
  const mixes = useMemo(
    () => raw?.map((mix) => ({ ...mix, songs: mix.songs.filter(isSafe) })).filter((mix) => mix.songs.length > 0),
    [raw, isSafe],
  );
  const failed = isError && !mixes?.length;
  const playQueue = usePlayerStore((s) => s.playQueue);

  return (
    <div className="vx-entity">
      <PageHeader
        title="Made for you"
        actions={<Link to="/taste-profile" className="vx-quiet-btn">How it works</Link>}
      />

      {isLoading && (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      )}

      {/* A failed request is not "warming up" — say so and offer the retry. */}
      {failed && <ErrorState retry={() => void refetch()} />}

      {!isLoading && !failed && (!mixes || mixes.length === 0) && (
        <EmptyState
          title="Your mixes are warming up"
          message="Play a few songs, favorite what you love, and personalized mixes will appear here within a few interactions."
          action={
            <Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">
              Start discovering
            </Link>
          }
        />
      )}

      {mixes?.map((mix) => (
        <Shelf
          key={mix.id}
          title={mix.title}
          explanation={mix.explanation}
          action={
            <button onClick={() => playQueue(mix.songs, 0)} className="vx-mix-play">
              <PlayIcon className="w-4 h-4" /> Play all
            </button>
          }
        >
          {mix.songs.map((song, i) => (
            <MediaCard
              key={song.id}
              to={songPath(song)}
              image={bestImage(song.images)} images={song.images}
              title={song.title}
              subtitle={song.subtitle}
              onPlay={() => playQueue(mix.songs, i)}
            />
          ))}
        </Shelf>
      ))}
    </div>
  );
}
