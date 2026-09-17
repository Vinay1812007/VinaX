import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { EmptyState } from '@/components/States';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { formatDuration } from '@/utils/format';
import { cn } from '@/utils/cn';
import { PlayIcon, ShuffleIcon, XIcon, DownloadIcon, LibraryIcon, ShareIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { downloadMany } from '@/services/downloads';
import { CollageCover } from '@/features/library/CollageCover';
import { findDuplicates } from '@/features/library/duplicates';
import { SORT_OPTIONS, shuffled, sortSongs, type CollectionSort } from '@/features/library/sort';
import { canShareText, collectionToText, copyText, shareText } from '@/features/library/collectionText';
import { allTags } from '@/features/library/tags';
import { TagChips, TagEditor } from '@/features/library/TagEditor';
import { filterSongs, songCount } from '@/features/library/collectionEdit';
import type { RemovedEntry } from '@/store/libraryStore';
import { occurrenceKeys, VirtualChunks } from '@/components/VirtualChunks';
import type { Song } from '@/types';

/**
 * v5.17.0 — collection page: collage cover, inline name/emoji/description
 * editing, pin, view-only sort, shuffle play, duplicate finder, copy/share as
 * text and a "Downloaded only" filter when offline copies exist.
 * v5.19.0 — tags in the Edit form (chips, suggestions from other playlists).
 * v6.1.0 — in-collection text search, multi-select with copy / move /
 * remove, and Undo for every destructive edit. Edits act on the STORED list
 * (ids), so a sorted or filtered view never changes the playback order.
 */
export default function CollectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const collection = useLibraryStore((s) => s.collections.find((c) => c.id === id));
  const allCollections = useLibraryStore((s) => s.collections);
  const downloads = useDownloadsStore((s) => s.items);
  const {
    renameCollection,
    deleteCollection,
    moveInCollection,
    togglePinCollection,
    dedupeCollection,
    updateCollectionMeta,
    setCollectionTags,
    addManyToCollection,
    removeManyFromCollection,
    restoreToCollection,
  } = useLibraryStore.getState();
  // v6.1.0 — search + multi-select state.
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [targetId, setTargetId] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection?.name ?? '');
  const [emoji, setEmoji] = useState(collection?.emoji ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [tags, setTags] = useState<string[]>(collection?.tags ?? []);
  // v5.19.0 — tags already used on OTHER playlists, offered as suggestions.
  const tagSuggestions = useMemo(() => allTags(allCollections.filter((c) => c.id !== id)), [allCollections, id]);
  const [sort, setSort] = useState<CollectionSort>('added');
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlDone, setDlDone] = useState(0);
  usePageTitle(collection?.name ?? 'Playlist');

  const songs = useMemo(() => collection?.songs ?? [], [collection]);
  const hasDownloads = Object.keys(downloads).length > 0;
  const downloadedCount = useMemo(() => songs.filter((s) => !!downloads[s.id]).length, [songs, downloads]);
  const duplicates = useMemo(() => findDuplicates(songs).duplicates.length, [songs]);
  const visible = useMemo(() => {
    const base = downloadedOnly && hasDownloads ? songs.filter((s) => !!downloads[s.id]) : songs;
    return sortSongs(filterSongs(base, query), sort);
  }, [songs, sort, downloadedOnly, hasDownloads, downloads, query]);
  const rowKeys = useMemo(() => occurrenceKeys(visible.map((s) => s.id)), [visible]);
  const filtering = query.trim() !== '';
  const reorderable = sort === 'added' && !(downloadedOnly && hasDownloads) && !filtering;
  const otherCollections = useMemo(() => allCollections.filter((c) => c.id !== id), [allCollections, id]);

  if (!collection) {
    return (
      <EmptyState
        title="Playlist not found"
        message="It may have been deleted — check Recently deleted in your Library."
        action={<Link to="/library" className="px-5 py-2.5 rounded-full btn-primary">Your Library</Link>}
      />
    );
  }

  const downloadAll = async () => {
    if (dlBusy || !songs.length) return;
    setDlBusy(true);
    setDlDone(0);
    const { saved, failed } = await downloadMany(songs, (d) => setDlDone(d));
    setDlBusy(false);
    // Honest reporting: a total failure used to read "Already saved offline".
    if (failed && saved) toast(`Saved ${saved} offline — ${failed} failed (check your connection)`);
    else if (failed) toast(`Downloads failed (${failed}) — check your connection and try again`);
    else toast(saved ? `Saved ${saved} song${saved === 1 ? '' : 's'} offline` : 'Already saved offline');
  };
  const playAll = () => {
    if (!visible.length) return;
    const p = usePlayerStore.getState();
    if (p.shuffle) p.toggleShuffle();
    p.playQueue(visible, 0);
  };
  const shufflePlay = () => {
    if (!visible.length) return;
    const p = usePlayerStore.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(shuffled(visible), 0);
  };
  const startEdit = () => {
    setName(collection.name);
    setEmoji(collection.emoji ?? '');
    setDescription(collection.description ?? '');
    setTags(collection.tags ?? []);
    setEditing(true);
  };
  const saveEdit = () => {
    const n = name.trim();
    if (n && n !== collection.name) renameCollection(collection.id, n);
    updateCollectionMeta(collection.id, { description, emoji });
    setCollectionTags(collection.id, tags);
    setEditing(false);
  };
  const remove = () => {
    const label = collection.name;
    deleteCollection(collection.id);
    toast(`Deleted “${label}” — restore it from Recently deleted in your Library`);
    navigate('/library');
  };
  const dedupe = () => {
    const n = dedupeCollection(collection.id);
    toast(n ? `Removed ${n} duplicate${n === 1 ? '' : 's'}` : 'No duplicates found');
  };
  const copyAsText = async () => {
    const ok = await copyText(collectionToText(songs));
    toast(ok ? `Copied ${songs.length} song${songs.length === 1 ? '' : 's'} as text` : 'Clipboard not available here');
  };
  const shareAsText = async () => {
    const ok = await shareText(collection.name, collectionToText(songs));
    if (ok) toast('Shared');
  };
  // ---- v6.1.0 multi-select actions (every destructive one is undoable) ----
  const selectedIds = [...selected].filter((sid) => songs.some((s) => s.id === sid));
  const selectedSongs = songs.filter((s) => selected.has(s.id));
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggleSelected = (sid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  const selectAllVisible = () => setSelected(new Set(visible.map((s) => s.id)));
  const undoRemoval = (removed: RemovedEntry[]) => {
    restoreToCollection(collection.id, removed);
    toast(`Restored ${songCount(removed.length)}`);
  };
  const removeSelected = () => {
    const removed = removeManyFromCollection(collection.id, selectedIds);
    if (!removed.length) return;
    exitSelect();
    toast(`Removed ${songCount(removed.length)} from “${collection.name}”`, { action: { label: 'Undo', onClick: () => undoRemoval(removed) }, duration: 7000 });
  };
  const copySelected = () => {
    const target = otherCollections.find((c) => c.id === targetId);
    if (!target) return;
    const added = addManyToCollection(target.id, selectedSongs);
    const skipped = selectedSongs.length - added;
    exitSelect();
    toast(
      added ? `Copied ${songCount(added)} to “${target.name}”${skipped ? ` · ${skipped} already there` : ''}` : `“${target.name}” already has ${selectedSongs.length === 1 ? 'that song' : 'those songs'}`,
      added ? { action: { label: 'Undo', onClick: () => { removeManyFromCollection(target.id, selectedSongs.map((s) => s.id).filter((sid) => !target.songs.some((t) => t.id === sid))); toast('Copy undone'); } }, duration: 7000 } : undefined,
    );
  };
  const moveSelected = () => {
    const target = otherCollections.find((c) => c.id === targetId);
    if (!target) return;
    const before = new Set(target.songs.map((t) => t.id));
    const added = addManyToCollection(target.id, selectedSongs);
    const removed = removeManyFromCollection(collection.id, selectedIds);
    exitSelect();
    toast(`Moved ${songCount(removed.length)} to “${target.name}”${added < removed.length ? ` · ${removed.length - added} already there` : ''}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          restoreToCollection(collection.id, removed);
          removeManyFromCollection(target.id, removed.map((r) => r.song.id).filter((sid) => !before.has(sid)));
          toast('Move undone');
        },
      },
      duration: 7000,
    });
  };
  const removeOne = (song: { id: string; title: string }) => {
    const removed = removeManyFromCollection(collection.id, [song.id]);
    toast(`Removed “${song.title}”`, { action: { label: 'Undo', onClick: () => undoRemoval(removed) }, duration: 6000 });
  };

  const pinLabel = collection.pinned ? 'Unpin' : 'Pin';
  const secondaryBtn = 'flex items-center gap-2 px-4 py-2.5 rounded-full border border-ink-600 text-sm font-semibold hover:border-ink-400 disabled:opacity-50';

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Playlist" />
      <div className="flex items-start gap-4 mb-1">
        <CollageCover songs={songs} emoji={collection.emoji} minPx={300} className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  aria-label="Emoji"
                  placeholder="🙂"
                  maxLength={8}
                  className="glass-input w-14 px-2 py-2 rounded-xl text-center text-xl"
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                  aria-label="Name"
                  autoFocus
                  className="glass-input flex-1 min-w-0 px-4 py-2 rounded-xl text-xl font-bold"
                />
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-label="Description"
                placeholder="What is this collection for? (optional)"
                rows={2}
                maxLength={280}
                className="glass-input w-full px-4 py-2 rounded-xl text-sm resize-none"
              />
              <TagEditor tags={tags} onChange={setTags} suggestions={tagSuggestions} />
              <div className="flex gap-2">
                <button onClick={saveEdit} className="px-4 py-1.5 rounded-full btn-primary text-xs font-bold">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="text-page-title flex-1 min-w-0 truncate">
                  {collection.emoji && <span className="mr-2" aria-hidden>{collection.emoji}</span>}
                  {collection.name}
                </h1>
                <button onClick={startEdit} className="text-xs font-semibold text-ink-300 hover:text-ink-100 shrink-0">Edit</button>
                <button
                  onClick={() => { togglePinCollection(collection.id); toast(collection.pinned ? 'Unpinned' : 'Pinned to the top of your Library'); }}
                  aria-pressed={!!collection.pinned}
                  className={cn('text-xs font-semibold shrink-0', collection.pinned ? 'text-ember-400' : 'text-ink-300 hover:text-ink-100')}
                >
                  {pinLabel}
                </button>
              </div>
              {collection.description && <p className="text-sm text-ink-300 mt-1 line-clamp-3">{collection.description}</p>}
              <TagChips tags={collection.tags} className="mt-1.5" />
            </>
          )}
          <p className="text-sm text-ink-400 mt-1">
            {songs.length} song{songs.length === 1 ? '' : 's'}
            {hasDownloads && downloadedCount > 0 && <span> · {downloadedCount} downloaded</span>}
            {collection.pinned && <span className="ml-2 text-ember-400 text-xs font-semibold">Pinned</span>}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-5 mb-4">
        <button onClick={playAll} disabled={!visible.length} className="flex items-center gap-2 px-5 py-2.5 rounded-full btn-primary disabled:opacity-50">
          <PlayIcon className="w-4 h-4" /> Play
        </button>
        <button onClick={shufflePlay} disabled={!visible.length} className={secondaryBtn}>
          <ShuffleIcon className="w-4 h-4" /> Shuffle play
        </button>
        {isNativePlatform() && (
          <button onClick={downloadAll} disabled={!songs.length || dlBusy} className={secondaryBtn}>
            <DownloadIcon className="w-4 h-4" /> {dlBusy ? `${dlDone}/${songs.length}` : 'Download'}
          </button>
        )}
        <button onClick={() => void copyAsText()} disabled={!songs.length} className={secondaryBtn}>Copy as text</button>
        {canShareText() && (
          <button onClick={() => void shareAsText()} disabled={!songs.length} className={secondaryBtn} aria-label="Share as text">
            <ShareIcon className="w-4 h-4" /> Share
          </button>
        )}
        <button onClick={remove} className="ml-auto px-4 py-2.5 rounded-full border border-ink-600 text-sm text-ink-300 hover:border-red-400 hover:text-red-300">Delete</button>
      </div>

      {duplicates > 0 && (
        <div role="status" className="flex items-center gap-3 glass-panel rounded-2xl px-4 py-3 mb-4">
          <span className="text-sm flex-1">
            <b>{duplicates} duplicate{duplicates === 1 ? '' : 's'}</b>
            <span className="text-ink-400"> — the same song appears more than once.</span>
          </span>
          <button onClick={dedupe} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 shrink-0">Remove duplicates</button>
        </div>
      )}

      {songs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label htmlFor="collection-search" className="sr-only">Search in this playlist</label>
          <input
            id="collection-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in this playlist"
            className="glass-input flex-1 min-w-[10rem] px-3 py-1.5 rounded-xl text-xs"
          />
          <button
            type="button"
            onClick={() => (selecting ? exitSelect() : setSelecting(true))}
            aria-pressed={selecting}
            className={cn('px-3 py-1.5 rounded-full border text-xs font-semibold min-h-[36px]', selecting ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400')}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
          <label className="flex items-center gap-2 text-xs text-ink-400">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CollectionSort)}
              aria-label="Sort songs"
              className="bg-ink-800 border border-ink-600 rounded-xl px-3 py-1.5 text-xs text-ink-100 outline-none focus:border-ember-500"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {hasDownloads && (
            <button
              onClick={() => setDownloadedOnly((v) => !v)}
              aria-pressed={downloadedOnly}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors',
                downloadedOnly ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400',
              )}
            >
              <DownloadIcon className="w-3.5 h-3.5" /> Downloaded only{downloadedOnly ? ` (${downloadedCount})` : ''}
            </button>
          )}
          {!reorderable && <span className="text-[11px] text-ink-500">View only — the stored order is unchanged.</span>}
          {filtering && (
            <span className="text-[11px] text-ink-500" role="status">
              {visible.length ? `${songCount(visible.length)} match` : 'No songs match'} “{query.trim()}”
            </span>
          )}
        </div>
      )}

      {selecting && (
        <div role="region" aria-label="Selected songs" className="glass-panel rounded-2xl px-3 py-2.5 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold" aria-live="polite">{selectedIds.length} selected</span>
          <button type="button" onClick={selectAllVisible} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 min-h-[36px]">
            Select all shown
          </button>
          <label htmlFor="collection-target" className="sr-only">Target playlist</label>
          <select
            id="collection-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="bg-ink-800 border border-ink-600 rounded-xl px-3 py-1.5 text-xs text-ink-100 outline-none focus:border-ember-500 min-h-[36px]"
          >
            <option value="">Choose a playlist…</option>
            {otherCollections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="button" onClick={copySelected} disabled={!selectedIds.length || !targetId} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 disabled:opacity-40 min-h-[36px]">
            Copy
          </button>
          <button type="button" onClick={moveSelected} disabled={!selectedIds.length || !targetId} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 disabled:opacity-40 min-h-[36px]">
            Move
          </button>
          <button type="button" onClick={removeSelected} disabled={!selectedIds.length} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold text-ink-300 hover:border-red-400 hover:text-red-300 disabled:opacity-40 min-h-[36px]">
            Remove
          </button>
          {!otherCollections.length && <span className="text-[11px] text-ink-500">Create another playlist to copy or move songs.</span>}
        </div>
      )}

      {!songs.length ? (
        <EmptyState icon={<LibraryIcon className="w-8 h-8" />} title="No songs yet" message="Add songs from any song's ⋯ menu → Add to this playlist." />
      ) : !visible.length ? (
        filtering ? (
          <EmptyState title="No matches" message={`Nothing in “${collection.name}” matches “${query.trim()}”.`} action={<button onClick={() => setQuery('')} className="px-5 py-2.5 rounded-full btn-primary">Clear search</button>} />
        ) : (
          <EmptyState icon={<DownloadIcon className="w-8 h-8" />} title="Nothing downloaded here yet" message="Turn off the Downloaded only filter, or download this collection." />
        )
      ) : (
        <div className="space-y-1">
          {/* Long playlists: rows render in content-visibility chunks so off-screen
              ones cost no layout or paint. Keys are index-free, so Move up / down
              re-orders DOM nodes instead of remounting the rows. */}
          <VirtualChunks
            items={visible}
            keyOf={(_song: Song, i: number) => rowKeys[i]}
            rowHeight={60}
            chunkClassName="space-y-1"
            renderItem={(song: Song, i: number) => (
            <div className={cn('flex items-center gap-2.5 glass-card rounded-xl p-2', selecting && selected.has(song.id) && 'ring-1 ring-ember-400')}>
              {selecting ? (
                <input
                  type="checkbox"
                  checked={selected.has(song.id)}
                  onChange={() => toggleSelected(song.id)}
                  aria-label={`Select ${song.title}`}
                  className="w-5 h-5 shrink-0 accent-[rgb(var(--ember-400))]"
                />
              ) : (
                <span className="w-5 text-center text-xs text-ink-500 shrink-0">{i + 1}</span>
              )}
              <button onClick={() => usePlayerStore.getState().playQueue(visible, i)} className="shrink-0" aria-label={`Play ${song.title}`}>
                <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-lg object-cover" />
              </button>
              <button onClick={() => usePlayerStore.getState().playQueue(visible, i)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold truncate">{song.title}</span>
                <span className="block text-xs text-ink-400 truncate">
                  {song.subtitle}
                  {song.year && <span className="text-ink-500"> · {song.year}</span>}
                </span>
              </button>
              <span className="hidden sm:block text-xs tabular-nums text-ink-400 shrink-0">{formatDuration(song.duration)}</span>
              {downloads[song.id] && <span className="text-tide-400 shrink-0" role="img" aria-label="Downloaded"><DownloadIcon className="w-3.5 h-3.5" /></span>}
              {reorderable && (
                <>
                  <button aria-label="Move up" disabled={i === 0} onClick={() => moveInCollection(collection.id, i, i - 1)} className="p-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-25 shrink-0">↑</button>
                  <button aria-label="Move down" disabled={i === visible.length - 1} onClick={() => moveInCollection(collection.id, i, i + 1)} className="p-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-25 shrink-0">↓</button>
                </>
              )}
              {!selecting && (
                <button aria-label={`Remove ${song.title} from playlist`} onClick={() => removeOne(song)} className="p-2 text-ink-400 hover:text-red-300 shrink-0 min-w-[36px] min-h-[36px] grid place-items-center">
                  <XIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            )}
          />
        </div>
      )}
    </div>
  );
}
