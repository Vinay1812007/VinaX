import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon, CompassIcon, HomeIcon, IdeaIcon, PlayIcon, SearchIcon } from './Icons';
import { IconButton } from './IconButton';
import { NAV_GROUPS, PRIMARY_NAV } from '@/constants/nav';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { cn } from '@/utils/cn';
import { useT } from '@/i18n';
import { useAccount } from './useAccount';
import { useUiStore } from '@/store/uiStore';

const ACTIONS_SLOT = 'vx-topbar-actions';
// 13.4.0 — the avatar's menu loads the first time it opens.
const ProfileMenu = lazy(() => import('./ProfileMenu'));
// The "Music languages" button and its picker: their own chunk, so the app shell stays small.
const LanguageButton = lazy(() => import('./LanguageButton'));
// 1.12 — Ideas & bugs: the popup behind the lightbulb, loaded when it is first opened.
const FeedbackSheet = lazy(() => import('./FeedbackSheet'));

/** The destinations that get a round icon button in the window bar (Home has its own, Library is the left panel). */
const BAR_NAV = PRIMARY_NAV.filter((i) => i.to !== '/' && i.to !== '/library');

/** Ideas & bugs, the language button, the ⌘K key and the avatar (or Sign in). */
function AccountTools({ onCommands }: { onCommands: () => void }) {
  const { pathname } = useLocation();
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
  const face = photo ? <img src={photo} alt="" width={32} height={32} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} /> : initial || <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5" aria-hidden><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></svg>;
  // 13.9 — a visitor browsing signed out gets a Sign in button where the avatar goes.
  const openSignIn = useUiStore((s) => s.openSignIn);
  // 1.12 — the lightbulb opens Ideas & bugs (feature ideas and bug reports), on every platform.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="vx-topbar-feedback"
        aria-label="Ideas &amp; bugs: suggest a feature or report a bug"
        aria-haspopup="dialog"
        aria-expanded={feedbackOpen}
        onClick={() => setFeedbackOpen(true)}
      >
        <IdeaIcon className="vx-topbar-feedback-icon" />
        <span>Ideas &amp; bugs</span>
      </button>
      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackSheet onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <LanguageButton />
      </Suspense>
      <button type="button" className="vx-command-key hidden lg:inline-flex" onClick={onCommands} aria-label="Open command palette, ⌘K" aria-keyshortcuts="Meta+K Control+K"><kbd>⌘</kbd><kbd>K</kbd></button>
      {!account ? (
        <button type="button" className="vx-topbar-signin" onClick={() => openSignIn('account')}>
          Sign in
        </button>
      ) : (
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
      )}
    </>
  );
}

/**
 * 1.15 — the window bar (768px and wider): it runs across the top of the
 * window, above the three panels. The mark, a round Home button, the search
 * pill (it opens Search, whose own field takes the typing) with Browse at
 * its end, round buttons for the other destinations, then Ideas & bugs, the
 * language, ⌘K and the avatar.
 */
export function WindowBar({ onCommands }: { onCommands: () => void }) {
  const { pathname } = useLocation();
  const t = useT();
  const onSearch = pathname.startsWith('/search');
  return (
    <header className="vx-winbar" aria-label="VinaX">
      <Link to="/" className="vx-winbar-brand" aria-label="VinaX Music home">
        <img src="/icons/icon.svg?v=14" alt="" width={32} height={32} />
        {/* 1.19 — the app's name beside the mark. */}
        <span className="vx-wordmark" aria-hidden>VinaX <em>Music</em></span>
      </Link>
      <nav aria-label="Main navigation" className="vx-winbar-nav">
        <NavLink to="/" end aria-label={t('Home')} title={t('Home')} className={({ isActive }) => cn('vx-winbar-home', isActive && 'is-active')}>
          {({ isActive }) => <HomeIcon className="w-6 h-6" filled={isActive} />}
        </NavLink>
        <div className={cn('vx-winbar-search', onSearch && 'is-active')}>
          {/* On Search the page's own field (with its suggestions) is portalled into this slot (pages/SearchPage.tsx). */}
          {onSearch ? (
            <div id="vx-winbar-search-slot" className="vx-winbar-search-slot vx-browse" />
          ) : (
            <Link to="/search" className="vx-winbar-search-field">
              <SearchIcon className="w-6 h-6 shrink-0" aria-hidden />
              <span>What do you want to play?</span>
            </Link>
          )}
          <span className="vx-winbar-search-rule" aria-hidden />
          <NavLink to="/discover" aria-label={t('Discover')} title={t('Discover')} className={({ isActive }) => cn('vx-winbar-browse', isActive && 'is-active')}>
            <CompassIcon className="w-6 h-6" />
          </NavLink>
        </div>
        {BAR_NAV.filter((i) => i.to !== '/discover').map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} aria-label={t(label)} title={t(label)} className={({ isActive }) => cn('vx-winbar-link', isActive && 'is-active')}>
            {({ isActive }) => <Icon className="w-5 h-5" filled={isActive} />}
          </NavLink>
        ))}
      </nav>
      <div className="vx-winbar-tools">
        <AccountTools onCommands={onCommands} />
      </div>
    </header>
  );
}

/**
 * The page's own bar, at the top of the scrolling page.
 * Phones: the mark and the page name, the page's actions, then the account
 * tools (there is no window bar on a phone). 768px and wider: back / forward
 * and, once the page scrolls, its name; the account tools live in the
 * window bar. It is clear at the top of the page, so artwork headers run up
 * behind it, and takes the page's colour (--hero) once content scrolls under.
 * Pages add buttons through <TopBarActions>.
 */
export function TopBar({ onCommands, windowBar }: { onCommands: () => void; windowBar: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navTitle = [...PRIMARY_NAV, ...NAV_GROUPS.flatMap((g) => g.items)].find((i) => i.to === pathname)?.label;
  const pageTitle = useUiStore((s) => s.pageTitle);
  const pageTone = useUiStore((s) => s.pageTone);
  const pagePlay = useUiStore((s) => s.pagePlay);
  const title = navTitle ?? pageTitle ?? 'VinaX';
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
  return (
    <>
    <div ref={sentinel} className="vx-topbar-sentinel" aria-hidden />
    <header className={cn('vx-topbar', scrolled && 'is-scrolled')} style={pageTone ? ({ '--hero-rgb': pageTone } as CSSProperties) : undefined}>
      {windowBar ? (
        <div className="flex items-center gap-2">
          <IconButton size="sm" label="Go back" onClick={() => navigate(-1)} className="vx-topbar-nav"><ChevronDownIcon className="w-5 h-5 rotate-90" /></IconButton>
          <IconButton size="sm" label="Go forward" onClick={() => navigate(1)} className="vx-topbar-nav"><ChevronDownIcon className="w-5 h-5 -rotate-90" /></IconButton>
        </div>
      ) : (
        <Link to="/" aria-label="VinaX Music home" className="vx-topbar-brand shrink-0">
          <img src="/icons/icon.svg?v=14" alt="" width={28} height={28} />
          {/* 1.19 — on Home the bar carries the app's name; elsewhere the page's name takes the room. */}
          {pathname === '/' && <span className="vx-wordmark" aria-hidden>VinaX <em>Music</em></span>}
        </Link>
      )}
      {pagePlay && (
        // A mouse shortcut that repeats the page's own play button (which keyboards and screen readers use), so it stays out of both.
        <button type="button" className="vx-topbar-play" aria-hidden title={pagePlay.label} onClick={pagePlay.run} tabIndex={-1}>
          <PlayIcon className="w-5 h-5" />
        </button>
      )}
      {!(pathname === '/' && !windowBar) && <span className="vx-topbar-context">{title}</span>}
      <div className="vx-topbar-actions">
        {/* Pages add their own actions here through <TopBarActions>. */}
        <div id={ACTIONS_SLOT} className="contents" />
        {!windowBar && <AccountTools onCommands={onCommands} />}
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
