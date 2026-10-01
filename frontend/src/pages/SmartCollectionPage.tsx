import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { EmptyState } from '@/components/States';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMenu, EntityMeta, PlayFab, totalDuration } from '@/components/EntityHeader';
import { collageArt, CollageCover } from '@/features/library/CollageCover';
import { PlusIcon, ShuffleIcon } from '@/components/Icons';
import { languageLabel } from '@/constants/languages';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSmartCollectionStore } from '@/store/smartCollectionStore';
import { toast } from '@/store/toastStore';
import { shuffled } from '@/features/library/sort';
import { describeRules, evaluateSmartCollection } from '@/features/library/smartCollections';
import { SmartCollectionSheet } from '@/features/library/SmartCollectionSheet';
import { songCount } from '@/features/library/collectionEdit';

/** v6.1.0 — a smart collection, evaluated live against the local library. */
export default function SmartCollectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const def = useSmartCollectionStore((s) => s.rules.find((c) => c.id === id));
  const remove = useSmartCollectionStore((s) => s.remove);
  const restore = useSmartCollectionStore((s) => s.restore);
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const later = useLibraryStore((s) => s.later);
  const history = useHistoryStore((s) => s.entries);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addManyToCollection = useLibraryStore((s) => s.addManyToCollection);
  const [editing, setEditing] = useState(false);
  usePageTitle(def?.name ?? 'Smart collection');

  const songs = useMemo(
    () => (def ? evaluateSmartCollection(def, { favorites, collections, later, history }) : []),
    [def, favorites, collections, later, history],
  );

  if (!def) {
    return (
      <EmptyState
        title="Smart collection not found"
        message="It may have been deleted."
        action={<Link to="/library" className="px-5 py-2.5 rounded-full btn-primary">Your Library</Link>}
      />
    );
  }

  const play = () => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (p.shuffle) p.toggleShuffle();
    p.playQueue(songs, 0);
  };
  const shufflePlay = () => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(songs), 0);
  };
  const freeze = () => {
    if (!songs.length) return;
    const cid = createCollection(`${def.name} (snapshot)`);
    addManyToCollection(cid, songs);
    toast(`Saved ${songCount(songs.length)} as a regular playlist`);
    navigate(`/collection/${cid}`);
  };
  const del = () => {
    const victim = remove(def.id);
    if (!victim) return;
    toast(`Deleted “${victim.name}”`, { action: { label: 'Undo', onClick: () => restore(victim) }, duration: 7000 });
    navigate('/library');
  };
  return (
    <div className="vx-entity">
      {editing && <SmartCollectionSheet existing={def} onClose={() => setEditing(false)} />}
      <EntityHeader
        kind="Smart collection"
        title={<>{def.emoji && <span className="mr-3" aria-hidden>{def.emoji}</span>}{def.name}</>}
        titleText={def.name}
        art={<CollageCover songs={songs} emoji={def.emoji} minPx={300} />}
        artUrl={collageArt(songs, 150)[0]}
        description={describeRules(def.rules, languageLabel)}
        meta={<EntityMeta items={[`${songCount(songs.length)} right now`, totalDuration(songs), 'Updates itself as you listen']} />}
        actions={
          <>
            <PlayFab size="lg" label="Play" onClick={play} disabled={!songs.length} />
            <EntityAction label="Shuffle play" onClick={shufflePlay} disabled={!songs.length}><ShuffleIcon /></EntityAction>
            <EntityAction label="Save as playlist" onClick={freeze} disabled={!songs.length}><PlusIcon /></EntityAction>
            <EntityMenu
              items={[
                { label: 'Edit rules', onSelect: () => setEditing(true) },
                { label: 'Save as playlist', onSelect: freeze, disabled: !songs.length },
                { label: 'Delete smart collection', onSelect: del, danger: true },
              ]}
            />
          </>
        }
      />

      {!songs.length ? (
        <EmptyState title="No matches yet" message="Nothing on this device matches these rules. Edit the rules, or listen to more music — smart collections only see songs your library already knows." />
      ) : (
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
