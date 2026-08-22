import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { EmptyState } from '@/components/States';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { PlayIcon, ShuffleIcon, XIcon, DownloadIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { downloadMany } from '@/services/downloads';

export default function CollectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const collection = useLibraryStore((s) => s.collections.find((c) => c.id === id));
  const { renameCollection, deleteCollection, removeFromCollection, moveInCollection } = useLibraryStore.getState();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection?.name ?? '');
  const [dlBusy, setDlBusy] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  usePageTitle(collection?.name ?? 'Playlist');

  if (!collection) {
    return (
      <EmptyState
        title="Playlist not found"
        message="It may have been deleted."
        action={<Link to="/library" className="px-5 py-2.5 rounded-full btn-primary">Your Library</Link>}
      />
    );
  }

  const songs = collection.songs;
  const downloadAll = async () => {
    if (dlBusy || !songs.length) return;
    setDlBusy(true);
    setDlDone(0);
    const { saved } = await downloadMany(songs, (d) => setDlDone(d));
    setDlBusy(false);
    toast(saved ? `Saved ${saved} song${saved === 1 ? '' : 's'} offline` : 'Already saved offline');
  };
  const playAll = (shuffle: boolean) => {
    if (!songs.length) return;
    const p = usePlayerStore.getState();
    if (shuffle && !p.shuffle) p.toggleShuffle();
    if (!shuffle && p.shuffle) p.toggleShuffle();
    p.playQueue(songs, shuffle ? Math.floor(Math.random() * songs.length) : 0);
  };
  const saveName = () => {
    const n = name.trim();
    if (n) renameCollection(collection.id, n);
    setEditing(false);
  };
  const remove = () => {
    if (window.confirm(`Delete "${collection.name}"?`)) {
      deleteCollection(collection.id);
      navigate('/library');
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Playlist" />
      <div className="flex items-center gap-3 mb-1">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            autoFocus
            className="glass-input flex-1 px-4 py-2 rounded-xl text-xl font-bold"
          />
        ) : (
          <h1 className="text-2xl font-extrabold flex-1 truncate">{collection.name}</h1>
        )}
        <button onClick={() => setEditing(true)} className="text-xs font-semibold text-ink-300 hover:text-ink-100 shrink-0">Rename</button>
      </div>
      <p className="text-sm text-ink-400 mb-5">{songs.length} song{songs.length === 1 ? '' : 's'}</p>

      <div className="flex gap-2 mb-6">
        <button onClick={() => playAll(false)} disabled={!songs.length} className="flex items-center gap-2 px-5 py-2.5 rounded-full btn-primary disabled:opacity-50">
          <PlayIcon className="w-4 h-4" /> Play
        </button>
        <button onClick={() => playAll(true)} disabled={!songs.length} className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-ink-600 font-semibold hover:border-ink-400 disabled:opacity-50">
          <ShuffleIcon className="w-4 h-4" /> Shuffle
        </button>
        {isNativePlatform() && (
          <button onClick={downloadAll} disabled={!songs.length || dlBusy} className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-ink-600 font-semibold hover:border-ink-400 disabled:opacity-50">
            <DownloadIcon className="w-4 h-4" /> {dlBusy ? `${dlDone}/${songs.length}` : 'Download'}
          </button>
        )}
        <button onClick={remove} className="ml-auto px-4 py-2.5 rounded-full border border-ink-600 text-sm text-ink-300 hover:border-red-400 hover:text-red-300">Delete</button>
      </div>

      {!songs.length ? (
        <EmptyState title="No songs yet" message="Add songs from any song's ⋯ menu → Add to this playlist." />
      ) : (
        <div className="space-y-1">
          {songs.map((song, i) => (
            <div key={song.id} className="flex items-center gap-2.5 glass-card rounded-xl p-2">
              <span className="w-5 text-center text-xs text-ink-500 shrink-0">{i + 1}</span>
              <button onClick={() => usePlayerStore.getState().playQueue(songs, i)} className="shrink-0" aria-label={`Play ${song.title}`}>
                <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-lg object-cover" />
              </button>
              <button onClick={() => usePlayerStore.getState().playQueue(songs, i)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold truncate">{song.title}</span>
                <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
              </button>
              <button aria-label="Move up" disabled={i === 0} onClick={() => moveInCollection(collection.id, i, i - 1)} className="p-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-25 shrink-0">↑</button>
              <button aria-label="Move down" disabled={i === songs.length - 1} onClick={() => moveInCollection(collection.id, i, i + 1)} className="p-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-25 shrink-0">↓</button>
              <button aria-label="Remove from playlist" onClick={() => { removeFromCollection(collection.id, song.id); toast('Removed'); }} className="p-1.5 text-ink-400 hover:text-red-300 shrink-0">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
