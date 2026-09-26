import { useCallback, useMemo, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMeta, GlyphCover, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { VirtualChunks } from '@/components/VirtualChunks';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { ShuffleIcon, DownloadIcon, HeartIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { downloadMany } from '@/services/downloads';
import { toast } from '@/store/toastStore';
import { useSessionState } from '@/hooks/useSessionState';

type SortMode = 'recent' | 'title' | 'artist';

/** .vx-track-row min-height — the off-screen size estimate for list chunks. */
const SONG_ROW_HEIGHT = 56;
const songKey = (song: Song): string => song.id;

function sortSongs(songs: Song[], mode: SortMode): Song[] {
  if (mode === 'recent') return songs;
  return [...songs].sort((a, b) =>
    mode === 'title' ? a.title.localeCompare(b.title) : a.subtitle.localeCompare(b.subtitle),
  );
}

export default function FavoritesPage() {
  usePageTitle('Liked songs');
  const favorites = useLibraryStore((s) => s.favorites);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const [sort, setSort] = useSessionState<SortMode>('vinax.favorites.sort.v1', 'recent');
  const sorted = useMemo(() => sortSongs(favorites, sort), [favorites, sort]);
  // Stable per `sorted`, so list chunks (and the memoised rows) skip re-rendering on unrelated page state.
  const renderRow = useCallback((song: Song, i: number) => <SongRow song={song} songs={sorted} index={i} />, [sorted]);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  const downloadAll = async () => {
    if (dlBusy || !sorted.length) return;
    setDlBusy(true);
    setDlDone(0);
    const { saved, failed } = await downloadMany(sorted, (d) => setDlDone(d));
    setDlBusy(false);
    // Honest reporting: a total failure used to read "Already saved offline".
    if (failed && saved) toast(`Saved ${saved} offline — ${failed} failed (check your connection)`);
    else if (failed) toast(`Downloads failed (${failed}) — check your connection and try again`);
    else toast(saved ? `Saved ${saved} song${saved === 1 ? '' : 's'} offline` : 'Already saved offline');
  };

  const shufflePlay = () => {
    if (!shuffle) toggleShuffle();
    playQueue(sorted, Math.floor(Math.random() * sorted.length));
  };

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Playlist"
        title="Liked songs"
        tone="var(--ember-500)"
        art={<GlyphCover tone="liked" icon={<HeartIcon filled />} />}
        meta={<EntityMeta items={[songsLabel(favorites.length), totalDuration(favorites), 'Stored on this device']} />}
        actions={favorites.length > 0 ? (
          <>
            <PlayFab label="Play all" onClick={() => playQueue(sorted, 0)} />
            <EntityAction label="Shuffle" onClick={shufflePlay}><ShuffleIcon /></EntityAction>
            {isNativePlatform() && (
              <>
                <EntityAction label={dlBusy ? `Downloading ${dlDone} of ${sorted.length}` : 'Download'} onClick={() => void downloadAll()} disabled={dlBusy}>
                  <DownloadIcon />
                </EntityAction>
                {dlBusy && <span className="vx-etools-note tabular-nums" aria-hidden>{dlDone}/{sorted.length}</span>}
              </>
            )}
          </>
        ) : undefined}
      />

      {favorites.length > 0 && (
        <div className="vx-etools" role="group" aria-label="Sort liked songs">
          {(['recent', 'title', 'artist'] as SortMode[]).map((m) => (
            <Chip key={m} active={sort === m} onClick={() => setSort(m)}>
              {m === 'recent' ? 'Recently added' : m === 'title' ? 'Title' : 'Artist'}
            </Chip>
          ))}
        </div>
      )}

      {favorites.length === 0 ? (
        <EmptyState
          icon={<HeartIcon className="w-8 h-8" />}
          title="No liked songs yet"
          message="Tap the heart on any song. Favorites power your “Similar to Favorites” recommendations."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Discover music</Link>}
        />
      ) : (
        <div className="vx-tracklist">
          <TrackListHead />
          <VirtualChunks items={sorted} keyOf={songKey} renderItem={renderRow} rowHeight={SONG_ROW_HEIGHT} />
        </div>
      )}
    </div>
  );
}
