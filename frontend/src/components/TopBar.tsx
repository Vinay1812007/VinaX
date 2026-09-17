import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon, SettingsIcon } from './Icons';
import { IconButton } from './IconButton';
import { PRIMARY_NAV } from '@/constants/nav';

const ACTIONS_SLOT = 'vx-topbar-actions';

/**
 * v7.0.1 — the bar no longer carries a search box: Search is a primary
 * destination (dock / sidebar), the Search page has its own field, and the
 * command palette is one key away, so a third box only crowded the bar (and
 * sat directly above the real one on /search). What remains is arranged as
 * two groups: where you are on the left, what you can do on the right.
 */
export function TopBar({ onCommands }: { onCommands: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const title = PRIMARY_NAV.find(i => i.to === pathname)?.label ?? 'Your music';
  return (
    <header className="vx-topbar">
      <div className="hidden md:flex items-center">
        <IconButton label="Go back" onClick={() => navigate(-1)}><ChevronDownIcon className="w-5 h-5 rotate-90" /></IconButton>
        <IconButton label="Go forward" onClick={() => navigate(1)}><ChevronDownIcon className="w-5 h-5 -rotate-90" /></IconButton>
      </div>
      <Link to="/" aria-label="VinaX home" className="md:hidden shrink-0"><img src="/icons/icon.svg" alt="" width={32} height={32} /></Link>
      <span className="vx-topbar-context">{title}</span>
      <div className="vx-topbar-actions">
        {/* Pages add their own actions here through <TopBarActions>. */}
        <div id={ACTIONS_SLOT} className="contents" />
        <button type="button" className="vx-command-key hidden lg:block" onClick={onCommands} aria-label="Open command palette">⌘ / Ctrl K</button>
        <Link to="/settings" className="vx-profile-link" aria-label="Local profile and settings" title="Local profile and settings"><SettingsIcon className="w-5 h-5" /><span className="hidden 2xl:inline">Your space</span></Link>
      </div>
    </header>
  );
}

/** Render a page's own actions (theme, notifications…) inside the top bar instead of in a row of their own. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(ACTIONS_SLOT)), []);
  return slot ? createPortal(children, slot) : null;
}
