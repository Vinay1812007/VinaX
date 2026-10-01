import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { PRIMARY_NAV } from '@/constants/nav';
import { bestImage } from '@/utils/images';
import { useT } from '@/i18n';
import { BookmarkIcon, ChevronDownIcon, ClockIcon, DownloadIcon, HeartIcon, LibraryIcon, PlusIcon } from './Icons';
import { IconButton } from './IconButton';

/** A library row's artwork: an image, or a tinted glyph tile for the built-in lists. */
function LibraryArt({ image, glyph, tone, round }: { image?: string | null; glyph?: ReactNode; tone?: string; round?: boolean }) {
  if (image) return <img src={image} alt="" loading="lazy" decoding="async" className={cn('vx-lib-art object-cover', round && 'rounded-full')} />;
  return <span className={cn('vx-lib-art vx-lib-glyph', tone)} aria-hidden>{glyph}</span>;
}

function LibraryRow({ to, title, meta, art, collapsed }: { to: string; title: string; meta: string; art: ReactNode; collapsed: boolean }) {
  return (
    <li>
      <NavLink to={to} end className={({ isActive }) => cn('vx-lib-row', isActive && 'is-active')} title={collapsed ? title : undefined} aria-label={collapsed ? `${title}, ${meta}` : undefined}>
        {art}
        {!collapsed && (
          <span className="vx-lib-text">
            <span className="vx-lib-title">{title}</span>
            <span className="vx-lib-meta">{meta}</span>
          </span>
        )}
      </NavLink>
    </li>
  );
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * 8.0.0 — the desktop sidebar: the main destinations, then the listener's
 * library as an artwork list (liked songs, listen later, downloads, recently
 * played, their playlists and the albums, playlists and artists they saved).
 * Collapses to an 80px rail that keeps every icon and artwork reachable.
 * 9.0.0 — Encore: the library sits in its own rounded panel, grouped into
 * "Your collections" and "Playlists & saved"; tablets always get the rail
 * (styles/shell.css), whatever the collapse setting says.
 */
export function Sidebar() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggle = useSettingsStore((s) => s.toggleSidebar);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const later = useLibraryStore((s) => s.later.length);
  const collections = useLibraryStore((s) => s.collections);
  const saved = useLibraryStore((s) => s.saved);
  const navigate = useNavigate();
  const t = useT();

  const createPlaylist = (): void => {
    const id = useLibraryStore.getState().createCollection(`My playlist #${collections.length + 1}`);
    navigate(`/collection/${id}`);
  };
  const ordered = [...collections].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  return (
    <aside className={cn('vx-sidebar hidden md:flex', collapsed && 'is-collapsed')} aria-label="Sidebar">
      <div className="vx-sidebar-head">
        <Link to="/" className="vx-brand" aria-label="VinaX home">
          <img src="/icons/icon.svg" alt="" width={28} height={28} />
          {!collapsed && <span>VinaX</span>}
        </Link>
        {!collapsed && (
          <IconButton size="sm" label="Collapse sidebar" onClick={toggle} className="vx-sidebar-toggle">
            <ChevronDownIcon className="w-5 h-5 rotate-90" />
          </IconButton>
        )}
      </div>
      {collapsed && (
        <div className="flex justify-center pb-2">
          <IconButton size="sm" label="Expand sidebar" onClick={toggle}>
            <ChevronDownIcon className="w-5 h-5 -rotate-90" />
          </IconButton>
        </div>
      )}

      <nav aria-label="Main navigation" className="vx-sidebar-nav">
        <ul>
          {PRIMARY_NAV.filter((i) => i.to !== '/library').map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} end={to === '/'} title={collapsed ? t(label) : undefined} aria-label={collapsed ? t(label) : undefined} className={({ isActive }) => cn('vx-nav-link', isActive && 'vx-nav-active')}>
                {({ isActive }) => (
                  <>
                    <Icon className="w-6 h-6 shrink-0" filled={isActive} />
                    {!collapsed && <span>{t(label)}</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <section className="vx-library" aria-label="Your library">
        <div className="vx-library-head">
          <NavLink to="/library" end className={({ isActive }) => cn('vx-library-title', isActive && 'is-active')} title={collapsed ? t('Library') : undefined} aria-label={collapsed ? t('Library') : undefined}>
            {({ isActive }) => (
              <>
                <LibraryIcon className="w-6 h-6 shrink-0" filled={isActive} />
                {!collapsed && <span>Your library</span>}
              </>
            )}
          </NavLink>
          {!collapsed && (
            <IconButton size="sm" label="Create playlist" onClick={createPlaylist}>
              <PlusIcon className="w-5 h-5" />
            </IconButton>
          )}
        </div>
        <ul className="vx-library-list no-scrollbar">
          {!collapsed && <li className="vx-lib-label" aria-hidden>Your collections</li>}
          <LibraryRow collapsed={collapsed} to="/favorites" title="Liked songs" meta={`Playlist · ${count(favorites, 'song')}`} art={<LibraryArt glyph={<HeartIcon className="w-5 h-5" filled />} tone="is-liked" />} />
          <LibraryRow collapsed={collapsed} to="/later" title="Listen later" meta={count(later, 'song')} art={<LibraryArt glyph={<BookmarkIcon className="w-5 h-5" />} tone="is-later" />} />
          <LibraryRow collapsed={collapsed} to="/offline" title="Downloads" meta="On this device" art={<LibraryArt glyph={<DownloadIcon className="w-5 h-5" />} tone="is-downloads" />} />
          <LibraryRow collapsed={collapsed} to="/history" title="Recently played" meta="History" art={<LibraryArt glyph={<ClockIcon className="w-5 h-5" />} tone="is-history" />} />
          {!collapsed && (ordered.length > 0 || saved.length > 0) && <li className="vx-lib-label" aria-hidden>Playlists &amp; saved</li>}
          {ordered.map((c) => {
            const cover = c.songs[0] ? bestImage(c.songs[0].images, 150) : null;
            return <LibraryRow key={c.id} collapsed={collapsed} to={`/collection/${c.id}`} title={c.name} meta={`Playlist · ${count(c.songs.length, 'song')}`} art={<LibraryArt image={cover} glyph={c.emoji || c.name.slice(0, 1).toUpperCase()} tone="is-playlist" />} />;
          })}
          {saved.map((e) => (
            <LibraryRow key={`${e.kind}:${e.id}`} collapsed={collapsed} to={`/${e.kind}/${e.id}`} title={e.title} meta={e.kind === 'artist' ? 'Artist' : `${e.kind === 'album' ? 'Album' : 'Playlist'}${e.subtitle ? ` · ${e.subtitle}` : ''}`} art={<LibraryArt image={e.image} round={e.kind === 'artist'} glyph={e.title.slice(0, 1).toUpperCase()} tone="is-playlist" />} />
          ))}
        </ul>
      </section>
    </aside>
  );
}
