import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMeta, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { collageArt, CollageCover } from '@/features/library/CollageCover';
import { EmptyState, ErrorState } from '@/components/States';
import { ListSkeleton } from '@/components/Skeletons';
import { PlusIcon, ShuffleIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useWeeklyMix, isoWeekKey } from '@/features/weekly/useWeeklyMix';
import { useShelfSafety } from '@/features/home/useShelfSafety';

export default function WeeklyMixPage() {
  usePageTitle('Your Week');
  const navigate = useNavigate();
  const { data: cached, isLoading, isError, refetch } = useWeeklyMix();
  // The week is cached until Monday, so a song hidden, an artist set to
  // "Never play", a language muted or Kid mode turned on mid-week would still
  // show here. Filter at render with the listener's current settings; Play,
  // Shuffle and Save use the same filtered list.
  const isSafe = useShelfSafety();
  const songs = useMemo(() => (cached ?? []).filter(isSafe), [cached, isSafe]);

  const play = (shuffle: boolean) => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (!shuffle && p.shuffle) p.toggleShuffle();
    p.playQueue(songs, 0, { shuffle });
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
    <div className="vx-entity">
      <EntityHeader
        kind="Mix"
        title="For you this week"
        art={<CollageCover songs={songs} minPx={300} />}
        artUrl={collageArt(songs, 150)[0]}
        meta={<EntityMeta items={[songs.length ? songsLabel(songs.length) : null, totalDuration(songs), 'Refreshes every Monday']} />}
        actions={
          songs.length > 0 ? (
            <>
              <PlayFab size="lg" label="Play" onClick={() => play(false)} />
              <EntityAction label="Shuffle" onClick={() => play(true)}><ShuffleIcon /></EntityAction>
              <EntityAction label="Save as playlist" onClick={save}><PlusIcon /></EntityAction>
            </>
          ) : undefined
        }
      />

      {isLoading && <ListSkeleton rows={10} />}
      {/* A network error used to read as "Building your week" — forever. */}
      {isError && !songs.length && <ErrorState retry={() => void refetch()} />}
      {!isLoading && !isError && !songs.length && (
        <EmptyState title="Building your week" message="Play a few songs and your weekly mix will appear here." />
      )}
      {songs.length > 0 && (
        <div className="vx-tracklist">
          <TrackListHead />
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={songs} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
