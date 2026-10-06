import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon } from './Icons';
import { IconButton } from './IconButton';
import { NAV_GROUPS, PRIMARY_NAV } from '@/constants/nav';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { cn } from '@/utils/cn';

const ACTIONS_SLOT = 'vx-topbar-actions';

/**
 * v7.0.1 — the bar carries no search box: Search is a primary destination and
 * has its own field. 8.0.0 — the bar floats over the page: transparent at the
 * top so artwork headers run up behind it, a surface once the page scrolls.
 * Left: back / forward (desktop) or the mark (phone) and the page name.
 * Right: the page's own actions (portalled in through <TopBarActions>), the
 * command palette key and the listener's avatar, which opens Settings.
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
  const name = getLocal<string>(KEYS.userName, '').trim();
  const initial = name ? name.slice(0, 1).toUpperCase() : '';
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
        <Link to="/settings" className="vx-avatar" aria-label="Local profile and settings" title="Local profile and settings">
          {initial || <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5" aria-hidden><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></svg>}
        </Link>
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
