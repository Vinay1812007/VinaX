import { useState } from 'react';
import { songPath } from '@/utils/slug';
import { Link } from 'react-router-dom';
import { MediaCard } from '@/components/MediaCard';
import { Shelf } from '@/components/Shelf';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { PlusIcon, UsersIcon, XIcon, ClockIcon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';

export default function LibraryPage() {
  usePageTitle('Library');
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const { createCollection, deleteCollection } = useLibraryStore.getState();
  const history = useHistoryStore((s) => s.entries);
  const [newName, setNewName] = useState('');

  return (
    <div className="max-w-4xl mx-auto vx-stagger">
      <PageHeader title="Library" subtitle="Everything here lives on this device only." />

      <Link
        to="/together"
        className="glass-panel rounded-2xl p-4 mb-8 flex items-center gap-3 hover:bg-ink-800/40 transition-colors"
      >
        <span className="w-10 h-10 rounded-xl bg-premium text-white flex items-center justify-center shrink-0">
          <UsersIcon className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sm">Listen Together</span>
          <span className="block text-xs text-ink-400">Play music in sync with friends — start or join a session.</span>
        </span>
        <span className="text-ink-400" aria-hidden>
          ›
        </span>
      </Link>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-title">Favorites</h2>
          {favorites.length > 0 && (
            <Link to="/favorites" className="text-xs font-semibold text-ember-400">See all ({favorites.length})</Link>
          )}
        </div>
        {favorites.length === 0 ? (
          <p className="text-sm text-ink-400">Tap the heart on any song to save it here.</p>
        ) : (
          favorites.slice(0, 5).map((song, i) => <SongRow key={song.id} song={song} songs={favorites} index={i} />)
        )}
      </section>

      {favorites.length > 0 && (
        <Shelf title="Recently Added" explanation="Your newest favorites">
          {favorites.slice(0, 12).map((song) => (
            <MediaCard
              key={`recent-${song.id}`}
              to={songPath(song)}
              image={song.images[song.images.length - 1]?.url ?? ''}
              title={song.title}
              subtitle={song.subtitle}
            />
          ))}
        </Shelf>
      )}

      {saved.length > 0 && (
        <Shelf title="Saved & Following" explanation="Albums, artists and playlists you keep">
          {saved.map((e) => (
            <MediaCard
              key={`${e.kind}-${e.id}`}
              to={`/${e.kind}/${e.id}`}
              image={e.image ?? ''}
              title={e.title}
              subtitle={e.kind[0].toUpperCase() + e.kind.slice(1)}
              round={e.kind === 'artist'}
            />
          ))}
        </Shelf>
      )}

      <section className="mb-10">
        <h2 className="text-title mb-3">Collections</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New collection name"
            className="flex-1 max-w-xs bg-ink-800 border border-ink-600 rounded-xl px-4 py-2 text-sm outline-none focus:border-ember-500"
          />
          <button
            onClick={() => {
              if (newName.trim()) {
                createCollection(newName.trim());
                setNewName('');
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm btn-primary"
          >
            <PlusIcon className="w-4 h-4" /> Create
          </button>
        </div>
        {collections.length === 0 && <p className="text-sm text-ink-400">Group songs your way — add any song from its ⋯ menu.</p>}
        <div className="space-y-4">
          {collections.map((col) => (
            <div key={col.id} className="rounded-2xl border border-ink-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <Link to={`/collection/${col.id}`} className="font-semibold hover:text-ember-400 text-left">
                  {col.name} <span className="text-xs text-ink-400 font-normal">· {col.songs.length} songs</span>
                </Link>
                <button aria-label={`Delete ${col.name}`} onClick={() => deleteCollection(col.id)} className="p-2.5 rounded-full text-ink-400 hover:text-red-400 hover:bg-red-500/10">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
              {col.songs.slice(0, 3).map((song, i) => <SongRow key={song.id} song={song} songs={col.songs} index={i} showArt={false} />)}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-title">Recently Played</h2>
          <Link to="/history" className="text-xs font-semibold text-ember-400">Full history</Link>
        </div>
        {history.length === 0 ? (
          <EmptyState
            icon={<ClockIcon className="w-8 h-8" />}
            title="Nothing played yet"
            message="Your listening history will appear here as you play."
            action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
          />
        ) : (
          history.slice(0, 5).map((e, i) => <SongRow key={`${e.song.id}-${e.ts}`} song={e.song} songs={history.map((h) => h.song)} index={i} />)
        )}
      </section>
    </div>
  );
}
