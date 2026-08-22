import { usePageTitle } from '@/hooks/usePageTitle';
import { songPath } from '@/utils/slug';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { PlayIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';

export default function MadeForYouPage() {
  usePageTitle('Made For You');
  const { data: mixes, isLoading } = useRecommendations();
  const playQueue = usePlayerStore((s) => s.playQueue);

  return (
    <div className="max-w-screen-2xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Made For You</h1>
      <p className="text-sm text-ink-400 mb-8">
        Every shelf is computed on this device from your listening — nothing leaves your browser.
        <Link to="/taste-profile" className="text-ember-400 font-semibold ml-1">See how →</Link>
      </p>

      {isLoading && (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      )}

      {!isLoading && (!mixes || mixes.length === 0) && (
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
            <button
              onClick={() => playQueue(mix.songs, 0)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs btn-primary"
            >
              <PlayIcon className="w-3.5 h-3.5" /> Play all
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
