import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon, SearchIcon, SettingsIcon } from './Icons';
import { IconButton } from './IconButton';
import { PRIMARY_NAV } from '@/constants/nav';

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
      <Link to="/" aria-label="VinaX home" className="md:hidden"><img src="/icons/icon.svg" alt="" width={32} height={32} /></Link>
      <span className="vx-topbar-context">{title}</span>
      <Link to="/search" className="vx-search-trigger"><SearchIcon className="w-5 h-5" /><span>Search songs, artists, albums</span></Link>
      <button type="button" className="vx-command-key hidden lg:block" onClick={onCommands} aria-label="Open command palette">⌘ / Ctrl K</button>
      <Link to="/settings" className="vx-profile-link" aria-label="Local profile and settings" title="Local profile and settings"><SettingsIcon className="w-5 h-5" /><span className="hidden 2xl:inline">Your space</span></Link>
    </header>
  );
}
