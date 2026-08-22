import { usePageTitle } from '@/hooks/usePageTitle';
import { Shelf } from '@/components/Shelf';
import { SongRow } from '@/components/SongRow';
import { ShelfSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';

const MIX_KIND_ICONS: Record<string, string> = {
  'made-for-you': '🎯',
  daily: '📅',
  language: '🌐',
  time: '🕐',
  rediscover: '🔁',
  'low-skip': '💎',
  because: '🎵',
  fresh: '✨',
};

export default function MixesPage() {
  usePageTitle('Mixes');
  const { data: mixes, isLoading } = useRecommendations();
  const playQueue = usePlayerStore((s) => s.playQueue);

  return (
    <div className="max-w-screen-xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Your Mixes</h1>
      <p className="text-sm text-ink-400 mb-8">
        Personalised playlists built from your listening history — updated throughout the day.{' '}
        <Link to="/taste-profile" className="text-ember-400 font-semibold">
          See your taste profile →
        </Link>
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
        <Shelf
          key={mix.id}
          title={`${MIX_KIND_ICONS[mix.kind] ?? '🎶'} ${mix.title}`}
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
          <div className="flex flex-col gap-0.5">
            {mix.songs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={mix.songs} index={i} showArt />
            ))}
          </div>
        </Shelf>
      ))}
    </div>
  );
}
