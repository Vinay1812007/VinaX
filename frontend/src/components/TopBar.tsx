import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon } from './Icons';
import { IconButton } from './IconButton';
import { NAV_GROUPS, PRIMARY_NAV } from '@/constants/nav';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { cn } from '@/utils/cn';
import { useAccount } from './useAccount';

const ACTIONS_SLOT = 'vx-topbar-actions';
// 13.4.0 — the avatar's menu loads the first time it opens.
const ProfileMenu = lazy(() => import('./ProfileMenu'));

/**
 * v7.0.1 — the bar carries no search box: Search is a primary destination and
 * has its own field. 8.0.0 — the bar floats over the page: transparent at the
 * top so artwork headers run up behind it, a surface once the page scrolls.
 * Left: back / forward (desktop) or the mark (phone) and the page name.
 * Right: the page's own actions (portalled in through <TopBarActions>), the
 * command palette key and the listener's avatar, which opens Settings.
 * 13.4.0 — the avatar opens a menu instead: profile settings, app settings
 * and Sign out (ProfileMenu).
 */
export function TopBar({ onCommands }: { onCommands: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const title = [...PRIMARY_NAV, ...NAV_GROUPS.flatMap((g) => g.items)].find((i) => i.to === pathname)?.label ?? 'VinaX';
  const [scrolled, setScrolled] = useState(false);
  // 10.1 — "is anything under the bar?" comes from an IntersectionObserver on
  // a marker 8px into the page, not a scroll listener: no work per scroll
  // frame, one callback when the answer flips.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    const main = document.getElementById('main-content');
    if (!el || !main || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { root: main });
    io.observe(el);
    return () => io.disconnect();
  }, [pathname]);
  // 13.0 — the signed-in Google account's photo; its initial when there is none.
  const account = useAccount();
  const name = (account?.user.name ?? getLocal<string>(KEYS.userName, '')).trim();
  const initial = name ? name.slice(0, 1).toUpperCase() : '';
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = !photoFailed && account?.user.picture ? account.user.picture : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) avatarRef.current?.focus();
  }, []);
  // A new page closes the menu.
  useEffect(() => setMenuOpen(false), [pathname]);
  const face = photo ? <img src={photo} alt="" width={36} height={36} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} /> : initial || <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5" aria-hidden><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></svg>;
  return (
    <>
    <div ref={sentinel} className="vx-topbar-sentinel" aria-hidden />
    <header className={cn('vx-topbar', scrolled && 'is-scrolled vx-mat-chrome')}>
      <div className="hidden md:flex items-center gap-1">
        <IconButton size="sm" label="Go back" onClick={() => navigate(-1)} className="vx-topbar-nav"><ChevronDownIcon className="w-5 h-5 rotate-90" /></IconButton>
        <IconButton size="sm" label="Go forward" onClick={() => navigate(1)} className="vx-topbar-nav"><ChevronDownIcon className="w-5 h-5 -rotate-90" /></IconButton>
      </div>
      <Link to="/" aria-label="VinaX home" className="md:hidden shrink-0"><img src="/icons/icon.svg" alt="" width={28} height={28} /></Link>
      <span className="vx-topbar-context">{title}</span>
      <div className="vx-topbar-actions">
        {/* Pages add their own actions here through <TopBarActions>. */}
        <div id={ACTIONS_SLOT} className="contents" />
        <button type="button" className="vx-command-key hidden lg:inline-flex" onClick={onCommands} aria-label="Open command palette"><kbd>⌘</kbd><kbd>K</kbd></button>
        <span className="vx-avatar-wrap">
          {/* No title tooltip: it sat over the Now playing panel. The label carries the name. */}
          <button
            ref={avatarRef}
            type="button"
            className={cn('vx-avatar', photo && 'has-photo', menuOpen && 'is-open')}
            aria-label={name ? `${name} — profile and settings` : 'Profile and settings'}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'vx-profile-menu' : undefined}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {face}
          </button>
          {menuOpen && (
            <Suspense fallback={null}>
              <ProfileMenu account={account} name={name} avatar={face} onClose={closeMenu} />
            </Suspense>
          )}
        </span>
      </div>
    </header>
    </>
  );
}

/** Render a page's own actions (theme, notifications…) inside the top bar instead of in a row of their own. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(ACTIONS_SLOT)), []);
  return slot ? createPortal(children, slot) : null;
}
