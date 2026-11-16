import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSettingsStore } from '@/store/settingsStore';
import { savedPath, useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { useT } from '@/i18n';
import { BookmarkIcon, ClockIcon, DownloadIcon, HeartIcon, LibraryIcon, PlusIcon, SearchIcon, VolumeIcon, XIcon } from './Icons';
import { IconButton } from './IconButton';

/** A library row's artwork: an image, or a tinted glyph tile for the built-in lists. */
function LibraryArt({ image, glyph, tone, round }: { image?: string | null; glyph?: ReactNode; tone?: string; round?: boolean }) {
  if (image) return <img src={image} alt="" loading="lazy" decoding="async" className={cn('vx-lib-art object-cover', round && 'rounded-full')} />;
  return <span className={cn('vx-lib-art vx-lib-glyph', tone)} aria-hidden>{glyph}</span>;
}

function LibraryRow({ to, title, meta, art, collapsed, playing }: { to: string; title: string; meta: string; art: ReactNode; collapsed: boolean; playing: boolean }) {
  return (
    <li>
      <NavLink to={to} end className={({ isActive }) => cn('vx-lib-row', isActive && 'is-active', playing && 'is-playing')} title={collapsed ? title : undefined} aria-label={collapsed ? `${title}, ${meta}` : undefined}>
        {art}
        {!collapsed && (
          <span className="vx-lib-text">
            <span className="vx-lib-title">{title}</span>
            <span className="vx-lib-meta">{meta}</span>
          </span>
        )}
        {!collapsed && playing && <span className="vx-lib-now" aria-hidden><VolumeIcon className="w-4 h-4" /></span>}
      </NavLink>
    </li>
  );
}

const SAVED_KIND_LABEL = { album: 'Album', playlist: 'Playlist', podcast: 'Podcast', artist: 'Artist' } as const;
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
type Filter = 'playlist' | 'album' | 'artist' | 'podcast';
const FILTERS: ReadonlyArray<[Filter, string]> = [['playlist', 'Playlists'], ['album', 'Albums'], ['artist', 'Artists'], ['podcast', 'Podcasts']];

interface Row {
  key: string;
  kind: Filter;
  to: string;
  title: string;
  meta: string;
  art: ReactNode;
  at: number;
}

/**
 * 1.15 — the left panel is the listener's library and nothing else (the
 * destinations moved to the window bar): "Your Library" with a + to start a
 * playlist, filter chips, a find-in-library field and a Recents / A–Z sort,
 * then Liked songs and the built-in lists, their playlists and everything
 * they saved, each a row with its artwork. The row whose list is playing has
 * a green title and a speaker. Collapses to an 80px rail of artwork; tablets
 * always get the rail (styles/shell.css), whatever the setting says.
 */
export function Sidebar() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggle = useSettingsStore((s) => s.toggleSidebar);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const later = useLibraryStore((s) => s.later.length);
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const playingPath = usePlayerStore((s) => s.context?.path ?? null);
  const navigate = useNavigate();
  const t = useT();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [finding, setFinding] = useState(false);
  const [find, setFind] = useState('');
  const [alpha, setAlpha] = useState(false);

  const createPlaylist = (): void => {
    const id = useLibraryStore.getState().createCollection(`My playlist #${collections.length + 1}`);
    navigate(`/collection/${id}`);
  };

  const rows = useMemo<Row[]>(() => {
    const own: Row[] = collections.map((c, i) => ({
      key: c.id,
      kind: 'playlist',
      to: `/collection/${c.id}`,
      title: c.name,
      meta: `Playlist · ${count(c.songs.length, 'song')}`,
      art: <LibraryArt image={c.songs[0] ? bestImage(c.songs[0].images, 150) : null} glyph={c.emoji || c.name.slice(0, 1).toUpperCase()} tone="is-playlist" />,
      // Pinned playlists first, then the listener's own order.
      at: c.pinned ? Number.MAX_SAFE_INTEGER - i : Number.MAX_SAFE_INTEGER / 2 - i,
    }));
    const theirs: Row[] = saved.map((e) => ({
      key: `${e.kind}:${e.id}`,
      kind: e.kind,
      to: savedPath(e),
      title: e.title,
      meta: e.kind === 'artist' ? 'Artist' : `${SAVED_KIND_LABEL[e.kind]}${e.subtitle ? ` · ${e.subtitle}` : ''}`,
      art: <LibraryArt image={e.image} round={e.kind === 'artist'} glyph={e.title.slice(0, 1).toUpperCase()} tone="is-playlist" />,
      at: e.savedAt,
    }));
    const needle = find.trim().toLowerCase();
    return [...own, ...theirs]
      .filter((r) => (!filter || r.kind === filter) && (!needle || r.title.toLowerCase().includes(needle)))
      .sort((a, b) => (alpha ? a.title.localeCompare(b.title) : b.at - a.at));
  }, [collections, saved, filter, find, alpha]);
  const builtIns = !filter || filter === 'playlist';
  const needle = find.trim().toLowerCase();
  const builtIn = (title: string) => builtIns && (!needle || title.toLowerCase().includes(needle));

  return (
    <aside className={cn('vx-sidebar hidden md:flex', collapsed && 'is-collapsed')} aria-label="Your library">
      <div className="vx-library-head">
        <button
          type="button"
          className="vx-library-title"
          onClick={toggle}
          aria-label={collapsed ? 'Expand Your Library' : 'Collapse Your Library'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand Your Library' : 'Collapse Your Library'}
        >
          <LibraryIcon className="w-6 h-6 shrink-0" />
          {!collapsed && <span>Your Library</span>}
        </button>
        {!collapsed && (
          <span className="vx-library-tools">
            <IconButton size="sm" label="Start a playlist" onClick={createPlaylist} className="vx-library-create">
              <PlusIcon className="w-5 h-5" />
            </IconButton>
            <NavLink to="/library" className="vx-library-open" aria-label={t('Library')} title="Open Your Library">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
            </NavLink>
          </span>
        )}
      </div>
      {collapsed && (
        <div className="vx-library-rail-create">
          <IconButton size="sm" label="Start a playlist" onClick={createPlaylist}><PlusIcon className="w-5 h-5" /></IconButton>
        </div>
      )}

      {!collapsed && (
        <>
          <div className="vx-library-chips no-scrollbar" role="group" aria-label="Show only">
            {filter && (
              <button type="button" className="vx-lib-chip is-clear" aria-label="Show everything" onClick={() => setFilter(null)}>
                <XIcon className="w-4 h-4" />
              </button>
            )}
            {FILTERS.filter(([id]) => !filter || filter === id).map(([id, label]) => (
              <button key={id} type="button" className={cn('vx-lib-chip', filter === id && 'is-on')} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? null : id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="vx-library-find">
            {finding ? (
              <label className="vx-library-find-field">
                <SearchIcon className="w-4 h-4 shrink-0" aria-hidden />
                <input
                  autoFocus
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setFind('');
                      setFinding(false);
                    }
                  }}
                  onBlur={() => !find && setFinding(false)}
                  placeholder="Search in Your Library"
                  aria-label="Search in Your Library"
                  maxLength={60}
                />
              </label>
            ) : (
              <IconButton size="sm" label="Search in Your Library" onClick={() => setFinding(true)}>
                <SearchIcon className="w-4 h-4" />
              </IconButton>
            )}
            <button type="button" className="vx-library-sort" onClick={() => setAlpha((a) => !a)} title={`Sort by ${alpha ? 'recents' : 'name'}`}>
              {alpha ? 'Alphabetical' : 'Recents'}
            </button>
          </div>
        </>
      )}

      <ul className="vx-library-list">
        {builtIn('Liked songs') && <LibraryRow collapsed={collapsed} playing={playingPath === '/favorites'} to="/favorites" title="Liked songs" meta={`Playlist · ${count(favorites, 'song')}`} art={<LibraryArt glyph={<HeartIcon className="w-5 h-5" filled />} tone="is-liked" />} />}
        {builtIn('Listen later') && <LibraryRow collapsed={collapsed} playing={playingPath === '/later'} to="/later" title="Listen later" meta={`Playlist · ${count(later, 'song')}`} art={<LibraryArt glyph={<BookmarkIcon className="w-5 h-5" filled />} tone="is-later" />} />}
        {builtIn('Downloads') && <LibraryRow collapsed={collapsed} playing={playingPath === '/offline'} to="/offline" title="Downloads" meta="On this device" art={<LibraryArt glyph={<DownloadIcon className="w-5 h-5" />} tone="is-downloads" />} />}
        {builtIn('Recently played') && <LibraryRow collapsed={collapsed} playing={playingPath === '/history'} to="/history" title="Recently played" meta="History" art={<LibraryArt glyph={<ClockIcon className="w-5 h-5" />} tone="is-history" />} />}
        {rows.map((r) => (
          <LibraryRow key={r.key} collapsed={collapsed} playing={!!playingPath && playingPath === r.to} to={r.to} title={r.title} meta={r.meta} art={r.art} />
        ))}
        {!collapsed && rows.length === 0 && (filter || needle) && (
          <li className="vx-lib-none">Nothing here matches{needle ? ` “${find.trim()}”` : ''}.</li>
        )}
      </ul>
    </aside>
  );
}
