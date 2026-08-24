import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { ListSkeleton } from '@/components/Skeletons';
import { PlayIcon, ShuffleIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useWeeklyMix, isoWeekKey } from '@/features/weekly/useWeeklyMix';

export default function WeeklyMixPage() {
  usePageTitle('Your Week');
  const navigate = useNavigate();
  const { data: songs = [], isLoading } = useWeeklyMix();

  const play = (shuffle: boolean) => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (shuffle && !p.shuffle) p.toggleShuffle();
    if (!shuffle && p.shuffle) p.toggleShuffle();
    p.playQueue(songs, shuffle ? Math.floor(Math.random() * songs.length) : 0);
  };

  const save = () => {
    if (!songs.length) return;
    const lib = useLibraryStore.getState();
    const name = `Your Week · ${isoWeekKey()}`;
    const id = lib.createCollection(name);
    songs.forEach((s) => lib.addToCollection(id, s));
    toast(`Saved “${name}”`);
    navigate(`/collection/${id}`);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="For You This Week"
        subtitle="A fresh personalized mix · refreshes every Monday"
        compact
        actions={
          songs.length > 0 ? (
            <>
              <button
                onClick={() => play(true)}
                className="flex items-center gap-2 px-4 min-h-touch rounded-full btn-secondary text-sm active:scale-95 transition-transform"
              >
                <ShuffleIcon className="w-4 h-4" /> Shuffle
              </button>
              <button
                onClick={() => play(false)}
                className="flex items-center gap-2 px-5 min-h-touch rounded-full btn-primary"
              >
                <PlayIcon className="w-4 h-4" /> Play
              </button>
            </>
          ) : undefined
        }
      />

      {songs.length > 0 && (
        <div className="mb-4">
          <button onClick={save} className="px-4 py-2 rounded-full border border-ink-600 text-sm font-semibold hover:border-ember-500 hover:text-ember-400">
            Save as playlist
          </button>
        </div>
      )}

      {isLoading && <ListSkeleton rows={10} />}
      {!isLoading && !songs.length && (
        <EmptyState title="Building your week" message="Play a few songs and your weekly mix will appear here." />
      )}
      <div className="space-y-1">
        {songs.map((song, i) => (
          <SongRow key={song.id} song={song} songs={songs} index={i} />
        ))}
      </div>
    </div>
  );
}
