import { usePageTitle } from '@/hooks/usePageTitle';
import { SectionHeader } from '@/components/SectionHeader';
import { SongRow } from '@/components/SongRow';
import { ShelfSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/library.css';


export default function MixesPage() {
  usePageTitle('Mixes');
  const { data: mixes, isLoading, isError, refetch } = useRecommendations();
  const failed = isError && !mixes?.length;
  const playQueue = usePlayerStore((s) => s.playQueue);

  return (
    <div className="vx-entity">
      <PageHeader
        title="Your mixes"
        actions={<Link to="/taste-profile" className="vx-quiet-btn">Taste profile</Link>}
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
          message="Play a few songs, favourite what you love, and your mixes will appear here within a few interactions."
          action={
            <Link
              to="/discover"
              className="px-5 py-2.5 rounded-full btn-primary"
            >
              Start discovering
            </Link>
          }
        />
      )}

      {mixes?.map((mix) => (
        <section key={mix.id} className="vx-shelf" aria-label={mix.title}>
          <SectionHeader
            title={mix.title}
            explanation={mix.explanation}
            action={
              <button onClick={() => playQueue(mix.songs, 0)} className="vx-mix-play">
                <PlayIcon className="w-4 h-4" /> Play all
              </button>
            }
          />
          <div className="vx-tracklist no-album vx-mix-list">
            {mix.songs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={mix.songs} index={i} showArt />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
