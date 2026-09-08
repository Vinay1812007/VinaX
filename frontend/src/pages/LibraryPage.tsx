import { useMemo, useState } from 'react';
import { songPath } from '@/utils/slug';
import { Link } from 'react-router-dom';
import { MediaCard } from '@/components/MediaCard';
import { Shelf } from '@/components/Shelf';
import { usePageTitle } from '@/hooks/usePageTitle';
import { orderCollections, useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { BookmarkIcon, PlusIcon, UsersIcon, XIcon, ClockIcon, DownloadIcon } from '@/components/Icons';
import { ImportPlaylistSheet } from '@/components/ImportPlaylistSheet';
import { flagOn, useFeatureFlags } from '@/features/home/useAppConfig';
import { PageHeader } from '@/components/PageHeader';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { CollageCover } from '@/features/library/CollageCover';
import { trashDaysLeft } from '@/features/library/trash';
import { allTags, matchesTags } from '@/features/library/tags';
import { TagChips } from '@/features/library/TagEditor';

/**
 * v5.17.0 — Library: pinned collections first with collage covers and emoji,
 * a "Downloaded only" chip when offline copies exist, and a Recently deleted
 * section that restores a trashed collection within seven days.
 * v5.19.0 — a multi-select tag filter row above the playlists; each tile
 * shows its tags as tiny chips.
 */
export default function LibraryPage() {
  usePageTitle('Library');
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const trash = useLibraryStore((s) => s.trash);
  const downloads = useDownloadsStore((s) => s.items);
  const { createCollection, deleteCollection, restoreCollection, purgeTrash } = useLibraryStore.getState();
  const history = useHistoryStore((s) => s.entries);
  const [newName, setNewName] = useState('');
  const [importing, setImporting] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const flags = useFeatureFlags();

  const hasDownloads = Object.keys(downloads).length > 0;
  const filterOn = downloadedOnly && hasDownloads;
  const shownFavorites = useMemo(
    () => (filterOn ? favorites.filter((s) => !!downloads[s.id]) : favorites),
    [favorites, filterOn, downloads],
  );
  // v5.19.0 — tags in use across every playlist; a selection that no longer
  // exists (tag removed on its last playlist) silently drops out of the filter.
  const tagsInUse = useMemo(() => allTags(collections), [collections]);
  const activeTags = useMemo(() => selectedTags.filter((t) => tagsInUse.includes(t)), [selectedTags, tagsInUse]);
  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  const shownCollections = useMemo(
    () =>
      orderCollections(collections)
        .filter((col) => matchesTags(col, activeTags))
        .map((col) => ({
          col,
          songs: filterOn ? col.songs.filter((s) => !!downloads[s.id]) : col.songs,
          downloaded: hasDownloads ? col.songs.filter((s) => !!downloads[s.id]).length : 0,
        })),
    [collections, activeTags, filterOn, hasDownloads, downloads],
  );
  const shownHistory = useMemo(
    () => (filterOn ? history.filter((e) => !!downloads[e.song.id]) : history),
    [history, filterOn, downloads],
  );
  const now = Date.now();

  const removeCollection = (id: string, name: string) => {
    deleteCollection(id);
    toast(`Deleted “${name}”`);
  };

  return (
    <div className="max-w-4xl mx-auto vx-stagger">
      <PageHeader
        title="Library"
        subtitle="Everything here lives on this device only."
        actions={
          <>
            <Link to="/later" className="btn-secondary px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5">
              <BookmarkIcon className="w-4 h-4" /> Listen Later
            </Link>
            <button onClick={() => setImporting(true)} className="btn-secondary px-3 py-2 text-xs font-bold">Import from text</button>
          </>
        }
      />
      {importing && <ImportPlaylistSheet onClose={() => setImporting(false)} />}

      {hasDownloads && (
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setDownloadedOnly((v) => !v)}
            aria-pressed={downloadedOnly}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors',
              downloadedOnly ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400',
            )}
          >
            <DownloadIcon className="w-3.5 h-3.5" /> Downloaded only
          </button>
          {filterOn && <span className="text-[11px] text-ink-500">Showing only songs saved offline.</span>}
        </div>
      )}

      {flagOn(flags, 'listenTogether') && <Link
        to="/together"
        className="glass-panel rounded-2xl p-4 mb-8 flex items-center gap-3 hover:bg-ink-800/40 transition-colors"
      >
        <span className="w-10 h-10 rounded-xl bg-ember-500 text-black flex items-center justify-center shrink-0">
          <UsersIcon className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sm">Listen Together</span>
          <span className="block text-xs text-ink-400">Play music in sync with friends — start or join a session.</span>
        </span>
        <span className="text-ink-400" aria-hidden>
          ›
        </span>
      </Link>}

      <section className="mb-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-title">Favorites</h2>
          {favorites.length > 0 && (
            <Link to="/favorites" className="text-xs font-semibold text-ember-400">See all ({favorites.length})</Link>
          )}
        </div>
        {favorites.length === 0 ? (
          <p className="text-sm text-ink-400">Tap the heart on any song to save it here.</p>
        ) : shownFavorites.length === 0 ? (
          <p className="text-sm text-ink-400">None of your favorites are downloaded yet.</p>
        ) : (
          shownFavorites.slice(0, 5).map((song, i) => <SongRow key={song.id} song={song} songs={shownFavorites} index={i} />)
        )}
      </section>

      {shownFavorites.length > 0 && (
        <Shelf title="Recently Added" explanation="Your newest favorites">
          {shownFavorites.slice(0, 12).map((song) => (
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

      {saved.length > 0 && !filterOn && (
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
        {tagsInUse.length > 0 && (
          <div role="group" aria-label="Filter playlists by tag" className="flex flex-wrap gap-1.5 mb-4">
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              aria-pressed={activeTags.length === 0}
              className={cn(
                'px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors',
                activeTags.length === 0 ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400',
              )}
            >
              All
            </button>
            {tagsInUse.map((tag) => {
              const on = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={on}
                  className={cn(
                    'px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors',
                    on ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400',
                  )}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
        {activeTags.length > 0 && shownCollections.length === 0 && (
          <p className="text-sm text-ink-400 mb-4">No playlists carry {activeTags.length === 1 ? 'that tag' : 'those tags'}.</p>
        )}
        <div className="space-y-4">
          {shownCollections.map(({ col, songs, downloaded }) => (
            <div key={col.id} className={cn('rounded-2xl border p-4', col.pinned ? 'border-ember-500/40' : 'border-ink-700')}>
              <div className="flex items-center gap-3 mb-2">
                <Link to={`/collection/${col.id}`} aria-label={`Open ${col.name}`} className="shrink-0">
                  <CollageCover songs={col.songs} emoji={col.emoji} className="w-14 h-14" />
                </Link>
                <Link to={`/collection/${col.id}`} className="min-w-0 flex-1 font-semibold hover:text-ember-400 text-left">
                  <span className="flex items-center gap-1.5">
                    {col.pinned && (
                      <span role="img" aria-label="Pinned" className="text-ember-400 text-xs" title="Pinned">📌</span>
                    )}
                    {col.emoji && <span aria-hidden>{col.emoji}</span>}
                    <span className="truncate">{col.name}</span>
                  </span>
                  <span className="block text-xs text-ink-400 font-normal">
                    {col.songs.length} song{col.songs.length === 1 ? '' : 's'}
                    {hasDownloads && downloaded > 0 && <span> · {downloaded} downloaded</span>}
                  </span>
                  {col.description && <span className="block text-xs text-ink-300 font-normal truncate">{col.description}</span>}
                  <TagChips tags={col.tags} className="mt-1 font-normal" />
                </Link>
                <button aria-label={`Delete ${col.name}`} onClick={() => removeCollection(col.id, col.name)} className="p-2.5 rounded-full text-ink-400 hover:text-red-400 hover:bg-red-500/10 shrink-0">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
              {songs.slice(0, 3).map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} showArt={false} />)}
              {filterOn && col.songs.length > 0 && songs.length === 0 && (
                <p className="text-xs text-ink-500 px-2">Nothing from this collection is downloaded.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
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
        ) : shownHistory.length === 0 ? (
          <p className="text-sm text-ink-400">Nothing you played recently is downloaded.</p>
        ) : (
          shownHistory.slice(0, 5).map((e, i) => <SongRow key={`${e.song.id}-${e.ts}`} song={e.song} songs={shownHistory.map((h) => h.song)} index={i} />)
        )}
      </section>

      {trash.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-title">Recently deleted</h2>
            <button onClick={() => { purgeTrash(); toast('Recently deleted cleared'); }} className="text-xs font-semibold text-ink-400 hover:text-red-300">Clear</button>
          </div>
          <p className="text-xs text-ink-500 mb-3">Deleted collections stay here for 7 days, then they are gone for good.</p>
          <div className="space-y-2">
            {trash.map(({ collection: col, deletedAt }) => {
              const days = trashDaysLeft(deletedAt, now);
              return (
                <div key={col.id} className="flex items-center gap-3 rounded-2xl border border-ink-700 border-dashed p-3">
                  <CollageCover songs={col.songs} emoji={col.emoji} className="w-10 h-10 opacity-70" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {col.emoji && <span className="mr-1.5" aria-hidden>{col.emoji}</span>}
                      {col.name}
                    </p>
                    <p className="text-xs text-ink-400">
                      {col.songs.length} song{col.songs.length === 1 ? '' : 's'} · {days} day{days === 1 ? '' : 's'} left
                    </p>
                  </div>
                  <button
                    onClick={() => { restoreCollection(col.id); toast(`Restored “${col.name}”`); }}
                    className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 shrink-0"
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
