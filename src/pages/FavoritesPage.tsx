import { useMemo, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { PlayIcon, ShuffleIcon, DownloadIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { downloadMany } from '@/services/downloads';
import { toast } from '@/store/toastStore';

type SortMode = 'recent' | 'title' | 'artist';

function sortSongs(songs: Song[], mode: SortMode): Song[] {
  if (mode === 'recent') return songs;
  return [...songs].sort((a, b) =>
    mode === 'title' ? a.title.localeCompare(b.title) : a.subtitle.localeCompare(b.subtitle),
  );
}

export default function FavoritesPage() {
  usePageTitle('Favorites');
  const favorites = useLibraryStore((s) => s.favorites);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const [sort, setSort] = useState<SortMode>('recent');
  const sorted = useMemo(() => sortSongs(favorites, sort), [favorites, sort]);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  const downloadAll = async () => {
    if (dlBusy || !sorted.length) return;
    setDlBusy(true);
    setDlDone(0);
    const { saved } = await downloadMany(sorted, (d) => setDlDone(d));
    setDlBusy(false);
    toast(saved ? `Saved ${saved} song${saved === 1 ? '' : 's'} offline` : 'Already saved offline');
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Favorites"
        subtitle={`${favorites.length} songs · stored locally`}
        compact
        actions={favorites.length > 0 ? (
          <>
            <button
              onClick={() => {
                if (!shuffle) toggleShuffle();
                playQueue(sorted, Math.floor(Math.random() * sorted.length));
              }}
              className="flex items-center gap-2 px-4 min-h-touch rounded-full btn-secondary text-sm active:scale-95 transition-transform"
            >
              <ShuffleIcon className="w-4 h-4" /> Shuffle
            </button>
            {isNativePlatform() && (
              <button onClick={downloadAll} disabled={dlBusy} className="flex items-center gap-2 px-4 min-h-touch rounded-full btn-secondary text-sm active:scale-95 transition-transform disabled:opacity-50">
                <DownloadIcon className="w-4 h-4" /> {dlBusy ? `${dlDone}/${sorted.length}` : 'Download'}
              </button>
            )}
            <button onClick={() => playQueue(sorted, 0)} className="flex items-center gap-2 px-5 min-h-touch rounded-full btn-primary">
              <PlayIcon className="w-4 h-4" /> Play all
            </button>
          </>
        ) : undefined}
      />

      {favorites.length > 0 && (
        <div className="flex gap-2 mb-4">
          {(['recent', 'title', 'artist'] as SortMode[]).map((m) => (
            <Chip key={m} active={sort === m} onClick={() => setSort(m)}>
              {m === 'recent' ? 'Recently added' : m === 'title' ? 'Title' : 'Artist'}
            </Chip>
          ))}
        </div>
      )}

      {favorites.length === 0 ? (
        <EmptyState
          title="No favorites yet"
          message="Tap the heart on any song. Favorites power your “Similar to Favorites” recommendations."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Discover music</Link>}
        />
      ) : (
        sorted.map((song, i) => <SongRow key={song.id} song={song} songs={sorted} index={i} />)
      )}
    </div>
  );
}
