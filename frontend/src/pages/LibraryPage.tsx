import { DestinationGrid } from '@/components/DestinationGrid';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MediaCard } from '@/components/MediaCard';
import { usePageTitle } from '@/hooks/usePageTitle';
import { orderCollections, useLibraryStore, type LocalCollection, type SavedEntity } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { PlusIcon, UsersIcon, XIcon, ClockIcon, SearchIcon, ListIcon, GridIcon, ChevronRightIcon } from '@/components/Icons';
import { ImportPlaylistSheet } from '@/components/ImportPlaylistSheet';
import { flagOn, useFeatureFlags } from '@/features/home/useAppConfig';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { IconButton } from '@/components/IconButton';
import { Chip } from '@/components/Chip';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { CollageCover } from '@/features/library/CollageCover';
import { trashDaysLeft } from '@/features/library/trash';
import { allTags, matchesTags } from '@/features/library/tags';
import { TagChips } from '@/features/library/TagEditor';
import { useSmartCollectionStore } from '@/store/smartCollectionStore';
import { describeRules, evaluateSmartCollection } from '@/features/library/smartCollections';
import { languageLabel } from '@/constants/languages';
import { useSessionState } from '@/hooks/useSessionState';
import { FALLBACK_ART } from '@/utils/images';
import { lazy, Suspense } from 'react';
import '@/styles/pages/library.css';

const SmartCollectionSheet = lazy(() => import('@/features/library/SmartCollectionSheet').then((m) => ({ default: m.SmartCollectionSheet })));

type Kind = 'all' | SavedEntity['kind'];
const KIND_CHIPS: Array<{ id: Exclude<Kind, 'all'>; label: string }> = [
  { id: 'playlist', label: 'Playlists' },
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
];
const KIND_LABEL: Record<SavedEntity['kind'], string> = { album: 'Album', artist: 'Artist', playlist: 'Playlist' };
const songsText = (n: number) => `${n} song${n === 1 ? '' : 's'}`;

/**
 * v5.17.0 — Library: pinned collections first with collage covers and emoji,
 * a "Downloaded only" chip when offline copies exist, and a Recently deleted
 * section that restores a trashed collection within seven days.
 * v5.19.0 — a multi-select tag filter row above the playlists; each tile
 * shows its tags as tiny chips.
 * v8.0.0 — one list for playlists and saved music (rows with 56px art, or a
 * grid), filter chips for the kinds, and create / import in the header.
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
  const [libraryQuery, setLibraryQuery] = useState('');
  const [librarySort, setLibrarySort] = useState<'recent' | 'az'>('recent');
  const [savedKind, setSavedKind] = useState<Kind>('all');
  const [view, setView] = useSessionState<'list' | 'grid'>('vinax.library.view.v1', 'list');
  const matchesLibrary = (title: string, subtitle = '') => `${title} ${subtitle}`.toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase());
  const visibleSaved = saved.filter(e => matchesLibrary(e.title, e.subtitle) && (savedKind === 'all' || e.kind === savedKind));
  if (librarySort === 'az') visibleSaved.sort((a, b) => a.title.localeCompare(b.title));
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // v6.1.0 — smart collections (rules over the local library).
  const [smartOpen, setSmartOpen] = useState(false);
  const smart = useSmartCollectionStore((s) => s.rules);
  const later = useLibraryStore((s) => s.later);
  const smartCounts = useMemo(
    () => Object.fromEntries(smart.map((c) => [c.id, evaluateSmartCollection(c, { favorites, collections, later, history }).length])),
    [smart, favorites, collections, later, history],
  );
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const flags = useFeatureFlags();

  const hasDownloads = Object.keys(downloads).length > 0;
  const filterOn = downloadedOnly && hasDownloads;
  const shownFavorites = useMemo(
    () => {
      const result = favorites.filter(s => (!filterOn || !!downloads[s.id]) && `${s.title} ${s.subtitle}`.toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase()));
      return librarySort === 'az' ? result.sort((a, b) => a.title.localeCompare(b.title)) : result;
    },
    [favorites, filterOn, downloads, libraryQuery, librarySort],
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
        .filter((col) => matchesTags(col, activeTags) && col.name.toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase()))
        .sort((a, b) => librarySort === 'az' ? a.name.localeCompare(b.name) : 0)
        .map((col) => ({
          col,
          songs: filterOn ? col.songs.filter((s) => !!downloads[s.id]) : col.songs,
          downloaded: hasDownloads ? col.songs.filter((s) => !!downloads[s.id]).length : 0,
        })),
    [collections, activeTags, filterOn, hasDownloads, downloads, libraryQuery, librarySort],
  );
  const shownHistory = useMemo(
    () => (filterOn ? history.filter((e) => !!downloads[e.song.id]) : history),
    [history, filterOn, downloads],
  );
  const now = Date.now();

  // What each filter chip shows. "All" is the whole library; a kind narrows
  // the list to that kind (your own playlists count as playlists).
  const showAll = savedKind === 'all';
  const showCollections = showAll || savedKind === 'playlist';
  const showSaved = saved.length > 0 && !filterOn;
  const listCollections = showCollections ? shownCollections : [];
  const listSaved = showSaved ? visibleSaved : [];
  const createOpen = creating || collections.length === 0;

  const removeCollection = (id: string, name: string) => {
    deleteCollection(id);
    toast(`Deleted “${name}”`);
  };
  const create = () => {
    if (!newName.trim()) return;
    createCollection(newName.trim());
    setNewName('');
    setCreating(false);
  };

  const collectionMeta = (col: LocalCollection, songs: LocalCollection['songs'], downloaded: number) =>
    [
      col.pinned ? 'Pinned' : null,
      'Playlist',
      filterOn ? (songs.length ? `${songs.length} downloaded` : 'Nothing downloaded') : songsText(col.songs.length),
      !filterOn && hasDownloads && downloaded > 0 ? `${downloaded} downloaded` : null,
    ].filter(Boolean).join(' · ');
  const savedMeta = (e: SavedEntity) =>
    [KIND_LABEL[e.kind], e.kind === 'album' && e.subtitle ? e.subtitle : null].filter(Boolean).join(' · ');

  return (
    <div className="vx-libpage">
      <PageHeader
        title="Your library"
        actions={
          <div className="vx-lib-actions">
            <button onClick={() => setImporting(true)} data-tour="import-text" className="vx-quiet-btn">Import from text</button>
            <IconButton label="Create playlist" onClick={() => setCreating((v) => !v)} aria-expanded={createOpen} aria-controls="library-create">
              <PlusIcon className="w-6 h-6" />
            </IconButton>
          </div>
        }
      />
      {importing && <ImportPlaylistSheet onClose={() => setImporting(false)} />}

      {createOpen && (
        <div id="library-create" className="vx-create-row">
          <span className="vx-field">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              aria-label="New collection name"
              placeholder="Playlist name"
              autoFocus={creating}
            />
          </span>
          <button onClick={create} className="btn-primary inline-flex items-center gap-1.5 px-4 min-h-[40px] text-sm">
            <PlusIcon className="w-4 h-4" /> Create
          </button>
        </div>
      )}

      {showAll && <DestinationGrid area="library" />}

      <div className="vx-lib-chips" role="group" aria-label="Filter your library">
        <Chip active={showAll} onClick={() => setSavedKind('all')}>All</Chip>
        {KIND_CHIPS.map((k) => (
          <Chip key={k.id} active={savedKind === k.id} onClick={() => setSavedKind(savedKind === k.id ? 'all' : k.id)}>{k.label}</Chip>
        ))}
        {hasDownloads && (
          <Chip active={downloadedOnly} onClick={() => setDownloadedOnly((v) => !v)}>Downloaded</Chip>
        )}
      </div>

      <div className="vx-lib-bar" role="search" aria-label="Search your library">
        <span className="vx-field">
          <SearchIcon />
          <input type="search" value={libraryQuery} onChange={e => setLibraryQuery(e.target.value)} aria-label="Search favorites, saved music and collections" placeholder="Search" />
          {libraryQuery && (
            <button type="button" onClick={() => setLibraryQuery('')} aria-label="Clear search" className="vx-field-clear"><XIcon className="w-4 h-4" /></button>
          )}
        </span>
        <select className="vx-select" aria-label="Sort library" value={librarySort} onChange={e => setLibrarySort(e.target.value as 'recent' | 'az')}>
          <option value="recent">Recents</option>
          <option value="az">Alphabetical</option>
        </select>
        <span className="vx-lib-view" role="group" aria-label="Layout">
          <IconButton size="sm" label="List view" onClick={() => setView('list')} aria-pressed={view === 'list'}><ListIcon className="w-5 h-5" /></IconButton>
          <IconButton size="sm" label="Grid view" onClick={() => setView('grid')} aria-pressed={view === 'grid'}><GridIcon className="w-5 h-5" /></IconButton>
        </span>
      </div>
      {filterOn && <p className="vx-etools-note -mt-4 mb-6">Showing only songs saved offline.</p>}


      <section className="vx-lib-section" aria-label="Playlists and saved music">
        {showCollections && tagsInUse.length > 0 && (
          <div role="group" aria-label="Filter playlists by tag" className="flex flex-wrap gap-2 mb-4">
            <Chip active={activeTags.length === 0} onClick={() => setSelectedTags([])}>All tags</Chip>
            {tagsInUse.map((tag) => (
              <Chip key={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>#{tag}</Chip>
            ))}
          </div>
        )}
        {showCollections && activeTags.length > 0 && shownCollections.length === 0 && (
          <p className="vx-lib-empty mb-4">No playlists carry {activeTags.length === 1 ? 'that tag' : 'those tags'}.</p>
        )}
        {listCollections.length === 0 && listSaved.length === 0 ? (
          <p className="vx-lib-empty">
            {libraryQuery.trim()
              ? `Nothing in your library matches “${libraryQuery.trim()}”.`
              : showCollections
                ? 'Group songs your way — add any song from its ⋯ menu, or save albums, artists and playlists.'
                : `No saved ${savedKind === 'album' ? 'albums' : 'artists'} yet.`}
          </p>
        ) : view === 'list' ? (
          <div className="vx-lrows">
            {listCollections.map(({ col, songs, downloaded }) => (
              <div key={col.id} className="vx-lrow">
                <Link to={`/collection/${col.id}`} className="vx-lrow-link">
                  <span className="vx-lrow-art"><CollageCover songs={col.songs} emoji={col.emoji} /></span>
                  <span className="vx-lrow-text">
                    <span className="vx-lrow-title">
                      {col.emoji && <span aria-hidden>{col.emoji}</span>}
                      <span className="t">{col.name}</span>
                    </span>
                    <span className="vx-lrow-meta">{collectionMeta(col, songs, downloaded)}</span>
                    <TagChips tags={col.tags} className="mt-1" />
                  </span>
                </Link>
                <button aria-label={`Delete ${col.name}`} title="Delete" onClick={() => removeCollection(col.id, col.name)} className="vx-row-x is-danger">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            {listSaved.map((e) => (
              <div key={`${e.kind}-${e.id}`} className="vx-lrow">
                <Link to={`/${e.kind}/${e.id}`} className="vx-lrow-link">
                  <span className={cn('vx-lrow-art', e.kind === 'artist' && 'is-round')}>
                    <img src={e.image || FALLBACK_ART} onError={(ev) => ((ev.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="vx-lrow-text">
                    <span className="vx-lrow-title"><span className="t">{e.title}</span></span>
                    <span className="vx-lrow-meta">{savedMeta(e)}</span>
                  </span>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="vx-lgrid">
            {listCollections.map(({ col, songs, downloaded }) => (
              <div key={col.id} className="vx-lgrid-item">
                <article className="vx-media-card group w-full">
                  <Link to={`/collection/${col.id}`} className="block">
                    <div className="vx-media-art"><CollageCover songs={col.songs} emoji={col.emoji} minPx={300} className="w-full h-full rounded-none" /></div>
                    <p className="vx-media-title">
                      {col.emoji && <span className="mr-1" aria-hidden>{col.emoji}</span>}
                      {col.name}
                    </p>
                  </Link>
                  <p className="vx-media-subtitle truncate">{collectionMeta(col, songs, downloaded)}</p>
                </article>
                <button aria-label={`Delete ${col.name}`} title="Delete" onClick={() => removeCollection(col.id, col.name)} className="vx-row-x">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            {listSaved.map((e) => (
              <MediaCard
                key={`${e.kind}-${e.id}`}
                to={`/${e.kind}/${e.id}`}
                image={e.image ?? ''}
                title={e.title}
                subtitle={KIND_LABEL[e.kind]}
                round={e.kind === 'artist'}
                fluid
              />
            ))}
          </div>
        )}
      </section>

      {showAll && (
        <section className="vx-lib-section">
          <SectionHeader title="Liked songs" seeAllTo={favorites.length > 0 ? '/favorites' : undefined} />
          {favorites.length === 0 ? (
            <p className="vx-lib-empty">Tap the heart on any song to save it here.</p>
          ) : shownFavorites.length === 0 ? (
            <p className="vx-lib-empty">No favorites match these filters.</p>
          ) : (
            <div className="vx-tracklist">
              {shownFavorites.slice(0, 5).map((song, i) => <SongRow key={song.id} song={song} songs={shownFavorites} index={i} />)}
            </div>
          )}
        </section>
      )}

      {showCollections && (
        <section className="vx-lib-section">
          <SectionHeader
            title="Smart collections"
            explanation="Rules that build a playlist from your library and keep it up to date."
            action={
              <button onClick={() => setSmartOpen(true)} className="vx-quiet-btn">
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
            <p className="vx-lib-empty">No smart collections yet — try “Telugu favourites played this month”.</p>
          ) : (
            <div className="vx-smart-grid">
              {smart.map((c) => (
                <Link key={c.id} to={`/smart/${c.id}`} className="vx-smart-card">
                  <span className="t">
                    {c.emoji && <span className="mr-1.5" aria-hidden>{c.emoji}</span>}
                    {c.name}
                  </span>
                  <span className="m">{describeRules(c.rules, languageLabel)}</span>
                  <span className="m">{smartCounts[c.id] ?? 0} song{(smartCounts[c.id] ?? 0) === 1 ? '' : 's'} right now</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {showAll && (
        <section className="vx-lib-section">
          <SectionHeader title="Recently played" seeAllTo="/history" />
          {history.length === 0 ? (
            <EmptyState
              icon={<ClockIcon className="w-8 h-8" />}
              title="Nothing played yet"
              message="Your listening history will appear here as you play."
              action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
            />
          ) : shownHistory.length === 0 ? (
            <p className="vx-lib-empty">Nothing you played recently is downloaded.</p>
          ) : (
            <div className="vx-tracklist">
              {shownHistory.slice(0, 5).map((e, i) => <SongRow key={`${e.song.id}-${e.ts}`} song={e.song} songs={shownHistory.map((h) => h.song)} index={i} />)}
            </div>
          )}
        </section>
      )}

      {showAll && flagOn(flags, 'listenTogether') && (
        <Link to="/together" className="vx-together">
          <span className="vx-together-glyph"><UsersIcon className="w-5 h-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-[15px]">Listen Together</span>
            <span className="block text-meta text-ink-400 truncate">Play in sync with friends</span>
          </span>
          <ChevronRightIcon className="w-5 h-5 text-ink-400" />
        </Link>
      )}

      {showCollections && trash.length > 0 && (
        <section className="vx-lib-section">
          <SectionHeader
            title="Recently deleted"
            explanation="Deleted collections stay here for 7 days, then they are gone for good."
            action={<button onClick={() => { purgeTrash(); toast('Recently deleted cleared'); }} className="vx-quiet-btn is-danger">Clear</button>}
          />
          <div className="vx-lrows">
            {trash.map(({ collection: col, deletedAt }) => {
              const days = trashDaysLeft(deletedAt, now);
              return (
                <div key={col.id} className="vx-lrow is-trashed">
                  <span className="vx-lrow-link">
                    <span className="vx-lrow-art"><CollageCover songs={col.songs} emoji={col.emoji} /></span>
                    <span className="vx-lrow-text">
                      <span className="vx-lrow-title">
                        {col.emoji && <span aria-hidden>{col.emoji}</span>}
                        <span className="t">{col.name}</span>
                      </span>
                      <span className="vx-lrow-meta">
                        {songsText(col.songs.length)} · {days} day{days === 1 ? '' : 's'} left
                      </span>
                    </span>
                  </span>
                  <button
                    onClick={() => { restoreCollection(col.id); toast(`Restored “${col.name}”`); }}
                    className="vx-quiet-btn shrink-0"
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
