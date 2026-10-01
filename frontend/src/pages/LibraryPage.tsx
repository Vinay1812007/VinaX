import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { orderCollections, useLibraryStore, type SavedEntity } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useSmartCollectionStore } from '@/store/smartCollectionStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { SongRow } from '@/components/SongRow';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { IconButton } from '@/components/IconButton';
import { Chip } from '@/components/Chip';
import type { EntityMenuItem } from '@/components/EntityHeader';
import { ChevronRightIcon, GridIcon, ListIcon, PlusIcon, SearchIcon, SparkleIcon, UsersIcon, XIcon } from '@/components/Icons';
import { ImportPlaylistSheet } from '@/components/ImportPlaylistSheet';
import { flagOn, useFeatureFlags } from '@/features/home/useAppConfig';
import { CollageCover } from '@/features/library/CollageCover';
import { LibraryCard, LibraryRow, type LibraryItem } from '@/features/library/LibraryItems';
import { LibraryShortcuts } from '@/features/library/LibraryShortcuts';
import { BackupIcon, HandoffIcon, ImportTextIcon } from '@/features/library/LibraryGlyphs';
import { trashDaysLeft } from '@/features/library/trash';
import { allTags, matchesTags } from '@/features/library/tags';
import { describeRules, evaluateSmartCollection } from '@/features/library/smartCollections';
import { filterSongs } from '@/features/library/collectionEdit';
import { playAlbum, playArtist, playPlaylist } from '@/features/player/playEntity';
import { isNativePlatform } from '@/services/native';
import { languageLabel } from '@/constants/languages';
import { useSessionState } from '@/hooks/useSessionState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { TopBarActions } from '@/components/TopBar';
import '@/styles/pages/library.css';

const SmartCollectionSheet = lazy(() => import('@/features/library/SmartCollectionSheet').then((m) => ({ default: m.SmartCollectionSheet })));
// The Backup Center is the same sheet Settings opens; it loads only when asked for.
const BackupCenter = lazy(() => import('@/features/settings/BackupCenter').then((m) => ({ default: m.BackupCenter })));

type Kind = 'all' | SavedEntity['kind'];
type Sort = 'recent' | 'az';
const KIND_CHIPS: Array<{ id: Exclude<Kind, 'all'>; label: string }> = [
  { id: 'playlist', label: 'Playlists' },
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
];
const KIND_LABEL: Record<SavedEntity['kind'], string> = { album: 'Album', artist: 'Artist', playlist: 'Playlist' };
const songsText = (n: number) => `${n} song${n === 1 ? '' : 's'}`;
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const normal = (s: string) => s.toLocaleLowerCase().normalize('NFC');
/** Does any of the fields contain the (already normalised) query? An empty query matches everything. */
const matchesQuery = (q: string, ...fields: (string | undefined)[]) => !q || normal(fields.filter(Boolean).join(' ')).includes(q);

/**
 * Library — everything you keep, on this device.
 *
 * v5.17.0 pinned collections, collage covers, Recently deleted; v5.19.0 tag
 * filters; v6.1.0 smart collections; v8.0.0 one list for playlists and saved
 * music with kind chips.
 *
 * 9.0 "Encore": shortcuts with live counts for liked songs, Listen later,
 * downloads and history; one list of playlists and saved music, pinned
 * first, sorted by when you added them or A–Z, as rows or artwork cards,
 * each with a ⋯ menu (pin, delete with undo, remove from library); search
 * reaches liked songs and smart collections too; and the Backup Center and
 * device handoff are one tap away at the end.
 */
export default function LibraryPage() {
  usePageTitle('Library');
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const trash = useLibraryStore((s) => s.trash);
  const later = useLibraryStore((s) => s.later);
  const downloads = useDownloadsStore((s) => s.items);
  const history = useHistoryStore((s) => s.entries);
  const smart = useSmartCollectionStore((s) => s.rules);
  const { createCollection, deleteCollection, restoreCollection, purgeTrash, togglePinCollection, toggleSaved } = useLibraryStore.getState();
  const flags = useFeatureFlags();
  // Phones keep Import and Create in the top bar's actions slot (two icon
  // buttons); wider screens show them as labelled pills beside the title.
  const phone = useMediaQuery('(max-width: 767px)');

  const [query, setQuery] = useState('');
  const [sort, setSort] = useSessionState<Sort>('vinax.library.sort.v1', 'recent');
  const [kind, setKind] = useSessionState<Kind>('vinax.library.kind.v1', 'all');
  const [view, setView] = useSessionState<'list' | 'grid'>('vinax.library.view.v1', 'list');
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  const q = normal(query.trim());
  const searching = q.length > 0;
  const hasDownloads = Object.keys(downloads).length > 0;
  const filterOn = downloadedOnly && hasDownloads;
  const showAll = kind === 'all';
  const showCollections = showAll || kind === 'playlist';

  // v5.19.0 — tags in use across every playlist; a selection that no longer
  // exists (tag removed on its last playlist) silently drops out of the filter.
  const tagsInUse = useMemo(() => allTags(collections), [collections]);
  const activeTags = useMemo(() => selectedTags.filter((t) => tagsInUse.includes(t)), [selectedTags, tagsInUse]);
  const toggleTag = (tag: string) => setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const smartCounts = useMemo(
    () => Object.fromEntries(smart.map((c) => [c.id, evaluateSmartCollection(c, { favorites, collections, later, history }).length])),
    [smart, favorites, collections, later, history],
  );

  // One list: your playlists and the music you saved. Pinned playlists lead;
  // the rest follow the chosen sort. A tag filter or "Downloaded" narrows the
  // list to your own playlists (saved music has neither).
  const items = useMemo(() => {
    const own: LibraryItem[] = showCollections
      ? orderCollections(collections)
          .filter((col) => matchesTags(col, activeTags) && matchesQuery(q, col.name, col.description, col.tags?.join(' ')))
          .map((col) => {
            const downloaded = hasDownloads ? col.songs.filter((s) => !!downloads[s.id]).length : 0;
            return {
              type: 'collection' as const,
              key: `c-${col.id}`,
              at: col.createdAt,
              title: col.name,
              col,
              songs: filterOn ? col.songs.filter((s) => !!downloads[s.id]) : col.songs,
              downloaded,
            };
          })
          .filter((it) => !filterOn || it.downloaded > 0)
      : [];
    const kept: LibraryItem[] =
      filterOn || activeTags.length
        ? []
        : saved
            .filter((e) => (showAll || e.kind === kind) && matchesQuery(q, e.title, e.subtitle))
            .map((entity) => ({ type: 'saved' as const, key: `${entity.kind}-${entity.id}`, at: entity.savedAt, title: entity.title, entity }));
    const rest = [...own.filter((it) => !(it.type === 'collection' && it.col.pinned)), ...kept];
    rest.sort((a, b) => (sort === 'az' ? collator.compare(a.title, b.title) : b.at - a.at));
    const pinned = own.filter((it) => it.type === 'collection' && it.col.pinned);
    if (sort === 'az') pinned.sort((a, b) => collator.compare(a.title, b.title));
    return [...pinned, ...rest];
  }, [collections, saved, showCollections, showAll, kind, activeTags, q, sort, filterOn, hasDownloads, downloads]);

  const likedShown = useMemo(() => {
    if (!searching && !filterOn) return [];
    const base = filterOn ? favorites.filter((s) => !!downloads[s.id]) : favorites;
    return searching ? filterSongs(base, query) : base;
  }, [favorites, downloads, filterOn, searching, query]);
  const smartShown = smart.filter((c) => matchesQuery(q, c.name));
  const recent = useMemo(() => (filterOn ? history.filter((e) => !!downloads[e.song.id]) : history).slice(0, 5), [history, filterOn, downloads]);
  const recentSongs = useMemo(() => recent.map((e) => e.song), [recent]);
  const now = Date.now();

  const createOpen = creating || collections.length === 0;
  const create = () => {
    if (!newName.trim()) return;
    createCollection(newName.trim());
    toast(`Created “${newName.trim()}”`);
    setNewName('');
    setCreating(false);
  };

  const metaFor = (it: LibraryItem): string => {
    if (it.type === 'saved') {
      const e = it.entity;
      return [KIND_LABEL[e.kind], e.kind !== 'artist' && e.subtitle && e.subtitle !== KIND_LABEL[e.kind] ? e.subtitle : null].filter(Boolean).join(' · ');
    }
    if (filterOn) return `Playlist · ${it.downloaded} of ${songsText(it.col.songs.length)} downloaded`;
    return ['Playlist', songsText(it.col.songs.length), hasDownloads && it.downloaded > 0 ? `${it.downloaded} downloaded` : null].filter(Boolean).join(' · ');
  };
  const menuFor = (it: LibraryItem): EntityMenuItem[] => {
    if (it.type === 'saved') {
      const e = it.entity;
      return [
        {
          label: e.kind === 'artist' ? 'Unfollow' : 'Remove from your library',
          onSelect: () => {
            toggleSaved(e);
            toast(e.kind === 'artist' ? `Unfollowed ${e.title}` : `Removed “${e.title}”`, {
              action: { label: 'Undo', onClick: () => toggleSaved(e) },
              duration: 7000,
            });
          },
          danger: true,
        },
      ];
    }
    const { col } = it;
    return [
      {
        label: col.pinned ? 'Unpin' : 'Pin to the top',
        onSelect: () => {
          togglePinCollection(col.id);
          toast(col.pinned ? `Unpinned “${col.name}”` : `Pinned “${col.name}” to the top`);
        },
      },
      {
        label: 'Delete playlist',
        danger: true,
        onSelect: () => {
          deleteCollection(col.id);
          toast(`Deleted “${col.name}”`, { action: { label: 'Undo', onClick: () => restoreCollection(col.id) }, duration: 7000 });
        },
      },
    ];
  };
  const playFor = (it: LibraryItem): (() => void) | undefined => {
    if (it.type === 'collection') return it.songs.length ? () => usePlayerStore.getState().playQueue(it.songs, 0) : undefined;
    const e = it.entity;
    if (e.kind === 'album') return () => void playAlbum(e.id, e.title);
    if (e.kind === 'playlist') return () => void playPlaylist(e.id, e.title);
    return () => void playArtist(e.id, e.title);
  };

  const summary = [
    collections.length ? `${collections.length} playlist${collections.length === 1 ? '' : 's'}` : null,
    favorites.length ? `${favorites.length} liked song${favorites.length === 1 ? '' : 's'}` : null,
    saved.length ? `${saved.length} saved` : null,
  ].filter(Boolean).join(' · ');

  const emptyListCopy = searching
    ? `Nothing in your library matches “${query.trim()}”.`
    : filterOn
      ? 'None of your playlists has a downloaded song yet.'
      : activeTags.length
        ? `No playlists carry ${activeTags.length === 1 ? 'that tag' : 'those tags'}.`
        : showCollections
          ? 'Group songs your way — add any song from its ⋯ menu, or save albums, artists and playlists.'
          : `No saved ${kind === 'album' ? 'albums' : 'artists'} yet. Save one from its page.`;

  return (
    <div className="vx-lp">
      <PageHeader
        title="Your library"
        subtitle={summary || 'Everything you keep, stored on this device'}
        actions={
          phone ? undefined : (
            <div className="vx-lp-actions">
              <button type="button" onClick={() => setImporting(true)} data-tour="import-text" className="vx-quiet-btn">
                Import from text
              </button>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                aria-expanded={createOpen}
                aria-controls="library-create"
                className="btn-primary vx-lp-create"
              >
                <PlusIcon className="w-[18px] h-[18px]" />
                Create playlist
              </button>
            </div>
          )
        }
      />
      {phone && (
        <TopBarActions>
          <span data-tour="import-text" className="inline-flex">
            <IconButton label="Import from text" onClick={() => setImporting(true)}>
              <ImportTextIcon className="w-[22px] h-[22px]" />
            </IconButton>
          </span>
          <IconButton label="Create playlist" onClick={() => setCreating((v) => !v)} aria-expanded={createOpen} aria-controls="library-create">
            <PlusIcon className="w-6 h-6" />
          </IconButton>
        </TopBarActions>
      )}
      {importing && <ImportPlaylistSheet onClose={() => setImporting(false)} />}

      {createOpen && (
        <div id="library-create" className="vx-lp-create-row">
          <span className="vx-lfield is-plain">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              aria-label="New collection name"
              placeholder="Name your playlist"
              autoFocus={creating}
            />
          </span>
          <button type="button" onClick={create} disabled={!newName.trim()} className="btn-primary vx-lp-create">
            Create
          </button>
        </div>
      )}

      {!searching && (
        <LibraryShortcuts
          counts={{
            liked: favorites.length,
            later: later.length,
            downloads: isNativePlatform() || hasDownloads ? Object.keys(downloads).length : null,
            plays: history.length,
          }}
        />
      )}

      <div className="vx-lp-tools">
        <div className="vx-lp-chips" role="group" aria-label="Filter your library">
          <Chip active={showAll} onClick={() => setKind('all')}>All</Chip>
          {KIND_CHIPS.map((k) => (
            <Chip key={k.id} active={kind === k.id} onClick={() => setKind(kind === k.id ? 'all' : k.id)}>{k.label}</Chip>
          ))}
          {hasDownloads && <Chip active={downloadedOnly} onClick={() => setDownloadedOnly((v) => !v)}>Downloaded</Chip>}
        </div>
        <div className="vx-lp-bar" role="search" aria-label="Search your library">
          <span className="vx-lfield">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search favorites, saved music and collections"
              placeholder="Search"
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="vx-lfield-clear">
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </span>
          <select className="vx-lselect" aria-label="Sort library" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recently added</option>
            <option value="az">A to Z</option>
          </select>
          <span className="vx-lp-view" role="group" aria-label="Layout">
            <IconButton size="sm" label="List view" onClick={() => setView('list')} active={view === 'list'} aria-pressed={view === 'list'}><ListIcon className="w-5 h-5" /></IconButton>
            <IconButton size="sm" label="Grid view" onClick={() => setView('grid')} active={view === 'grid'} aria-pressed={view === 'grid'}><GridIcon className="w-5 h-5" /></IconButton>
          </span>
          {/* Phones: one toggle (the CSS shows one control or the other, never both). */}
          <IconButton
            size="md"
            label="Grid view"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            aria-pressed={view === 'grid'}
            className="vx-lp-view-toggle"
          >
            {view === 'grid' ? <GridIcon className="w-5 h-5" /> : <ListIcon className="w-5 h-5" />}
          </IconButton>
        </div>
        {showCollections && tagsInUse.length > 0 && !filterOn && (
          <div role="group" aria-label="Filter playlists by tag" className="vx-lp-tags">
            <Chip active={activeTags.length === 0} onClick={() => setSelectedTags([])}>All tags</Chip>
            {tagsInUse.map((tag) => (
              <Chip key={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>#{tag}</Chip>
            ))}
          </div>
        )}
        {filterOn && <p className="vx-lp-note" role="status">Showing only what plays offline.</p>}
      </div>

      <section className="vx-lp-section" aria-label="Playlists and saved music">
        {items.length === 0 ? (
          <p className="vx-lp-empty">{emptyListCopy}</p>
        ) : view === 'list' ? (
          <div className="vx-lp-rows">
            {items.map((it) => <LibraryRow key={it.key} item={it} meta={metaFor(it)} menu={menuFor(it)} />)}
          </div>
        ) : (
          <div className="vx-lp-grid">
            {items.map((it) => <LibraryCard key={it.key} item={it} meta={metaFor(it)} menu={menuFor(it)} onPlay={playFor(it)} />)}
          </div>
        )}
      </section>

      {likedShown.length > 0 && (
        <section className="vx-lp-section">
          <SectionHeader
            title={filterOn && !searching ? 'Downloaded liked songs' : 'Liked songs'}
            explanation={searching ? `${songsText(likedShown.length)} match “${query.trim()}”` : undefined}
            seeAllTo="/favorites"
          />
          <div className="vx-tracklist">
            {likedShown.slice(0, 5).map((song, i) => <SongRow key={song.id} song={song} songs={likedShown} index={i} />)}
          </div>
        </section>
      )}

      {showCollections && !filterOn && (!searching || smartShown.length > 0) && (
        <section className="vx-lp-section">
          <SectionHeader
            title="Smart collections"
            explanation="Rules that build a playlist from your library and keep it up to date."
            action={
              <button type="button" onClick={() => setSmartOpen(true)} className="vx-quiet-btn">
                <PlusIcon className="w-4 h-4" /> New
              </button>
            }
          />
          {smartOpen && (
            <Suspense fallback={null}>
              <SmartCollectionSheet onClose={() => setSmartOpen(false)} />
            </Suspense>
          )}
          {smart.length === 0 ? (
            <p className="vx-lp-empty">No smart collections yet — try “Telugu favourites played this month”.</p>
          ) : (
            <div className="vx-lp-smart">
              {smartShown.map((c) => (
                <Link key={c.id} to={`/smart/${c.id}`} className="vx-lp-smart-card">
                  <span className="vx-lp-smart-glyph" aria-hidden>{c.emoji || <SparkleIcon className="w-5 h-5" />}</span>
                  <span className="vx-lp-smart-text">
                    <span className="t">{c.name}</span>
                    <span className="m">{describeRules(c.rules, languageLabel)}</span>
                    <span className="n">{smartCounts[c.id] ?? 0} song{(smartCounts[c.id] ?? 0) === 1 ? '' : 's'} right now</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {showAll && !searching && recent.length > 0 && (
        <section className="vx-lp-section">
          <SectionHeader title={filterOn ? 'Recently played, downloaded' : 'Recently played'} seeAllTo="/history" />
          <div className="vx-tracklist">
            {recent.map((e, i) => <SongRow key={`${e.song.id}-${e.ts}`} song={e.song} songs={recentSongs} index={i} />)}
          </div>
        </section>
      )}

      {showAll && !searching && flagOn(flags, 'listenTogether') && (
        <div className="vx-lp-links vx-lp-section">
          <Link to="/together" aria-label="Listen Together" aria-describedby="lp-together-note" className="vx-lp-link">
            <span className="vx-lp-link-glyph" aria-hidden><UsersIcon className="w-5 h-5" /></span>
            <span className="vx-lp-link-text">
              <span className="t">Listen Together</span>
              <span className="m" id="lp-together-note">Play in sync with friends</span>
            </span>
            <ChevronRightIcon className="vx-lp-link-go" />
          </Link>
        </div>
      )}

      {showCollections && !searching && trash.length > 0 && (
        <section className="vx-lp-section">
          <SectionHeader
            title="Recently deleted"
            explanation="Deleted collections stay here for 7 days, then they are gone for good."
            action={<button type="button" onClick={() => { purgeTrash(); toast('Recently deleted cleared'); }} className="vx-quiet-btn is-danger">Clear</button>}
          />
          <div className="vx-lp-rows">
            {trash.map(({ collection: col, deletedAt }) => {
              const days = trashDaysLeft(deletedAt, now);
              return (
                <div key={col.id} className="vx-lp-row is-trashed">
                  <span className="vx-lp-row-link">
                    <span className="vx-lp-row-art"><CollageCover songs={col.songs} emoji={col.emoji} /></span>
                    <span className="vx-lp-row-text">
                      <span className="vx-lp-row-title">
                        {col.emoji && <span className="vx-lp-emoji" aria-hidden>{col.emoji}</span>}
                        <span className="t">{col.name}</span>
                      </span>
                      <span className="vx-lp-row-meta"><span className="m">{songsText(col.songs.length)} · {days} day{days === 1 ? '' : 's'} left</span></span>
                    </span>
                  </span>
                  <button type="button" onClick={() => { restoreCollection(col.id); toast(`Restored “${col.name}”`); }} className="vx-quiet-btn shrink-0">
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showAll && !searching && (
        <section className="vx-lp-section">
          <SectionHeader title="Keep it with you" explanation="Your library lives on this device. Back it up, or carry it to a new one." />
          <div className="vx-lp-links">
            {/* Each row is named by its title; the note is its description. */}
            <button type="button" onClick={() => setBackupOpen(true)} aria-label="Backup Center" aria-describedby="lp-backup-note" className="vx-lp-link">
              <span className="vx-lp-link-glyph" aria-hidden><BackupIcon /></span>
              <span className="vx-lp-link-text">
                <span className="t">Backup Center</span>
                <span className="m" id="lp-backup-note">Export, or restore with a preview and undo</span>
              </span>
              <ChevronRightIcon className="vx-lp-link-go" />
            </button>
            <Link to="/handoff" aria-label="Move to a new device" aria-describedby="lp-handoff-note" className="vx-lp-link">
              <span className="vx-lp-link-glyph" aria-hidden><HandoffIcon /></span>
              <span className="vx-lp-link-text">
                <span className="t">Move to a new device</span>
                <span className="m" id="lp-handoff-note">An encrypted, one-use QR code</span>
              </span>
              <ChevronRightIcon className="vx-lp-link-go" />
            </Link>
          </div>
          {backupOpen && (
            <Suspense fallback={null}>
              <BackupCenter onClose={() => setBackupOpen(false)} />
            </Suspense>
          )}
        </section>
      )}
    </div>
  );
}
