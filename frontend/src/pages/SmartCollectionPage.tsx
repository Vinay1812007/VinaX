import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/States';
import { SongRow } from '@/components/SongRow';
import { PlayIcon, ShuffleIcon } from '@/components/Icons';
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
  const secondaryBtn = 'flex items-center gap-2 px-4 py-2.5 rounded-full border border-ink-600 text-sm font-semibold hover:border-ink-400 disabled:opacity-50';

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Smart collection" />
      {editing && <SmartCollectionSheet existing={def} onClose={() => setEditing(false)} />}
      <div className="mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-page-title flex-1 min-w-0 truncate">
            {def.emoji && <span className="mr-2" aria-hidden>{def.emoji}</span>}
            {def.name}
          </h1>
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-ink-300 hover:text-ink-100 shrink-0">Edit rules</button>
        </div>
        <p className="text-sm text-ink-300 mt-1">{describeRules(def.rules, languageLabel)}</p>
        <p className="text-sm text-ink-400 mt-1">
          {songCount(songs.length)} right now · built from your local library, updates itself as you listen
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mt-5 mb-4">
        <button onClick={play} disabled={!songs.length} className="flex items-center gap-2 px-5 py-2.5 rounded-full btn-primary disabled:opacity-50">
          <PlayIcon className="w-4 h-4" /> Play
        </button>
        <button onClick={shufflePlay} disabled={!songs.length} className={secondaryBtn}>
          <ShuffleIcon className="w-4 h-4" /> Shuffle play
        </button>
        <button onClick={freeze} disabled={!songs.length} className={secondaryBtn} title="Copy today's result into a regular playlist">Save as playlist</button>
        <button onClick={del} className="ml-auto px-4 py-2.5 rounded-full border border-ink-600 text-sm text-ink-300 hover:border-red-400 hover:text-red-300">Delete</button>
      </div>

      {!songs.length ? (
        <EmptyState title="No matches yet" message="Nothing on this device matches these rules. Edit the rules, or listen to more music — smart collections only see songs your library already knows." />
      ) : (
        <div className="space-y-1">
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={songs} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
