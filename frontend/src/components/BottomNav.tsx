import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { CompassIcon, HomeIcon, LibraryIcon, SearchIcon, SparkleIcon } from './Icons';
import { haptic } from '@/services/native';
import { useT } from '@/i18n';

interface DockItem {
  to: string;
  label: string;
  icon: typeof HomeIcon;
}

const items: DockItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/discover', label: 'Discover', icon: CompassIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/library', label: 'Library', icon: LibraryIcon },
  { to: '/VinaXAI', label: 'VinaX AI', icon: SparkleIcon },
];

/** 8.0.0 — the phone tab bar: a translucent strip, each tab an icon over its
 *  label. 10.0.0 — the active tab's solid icon sits in a Marigold pill.
 *  10.1.0 — the chrome material: the page scrolls under it, frosted. */
export function BottomNav() {
  const t = useT();
  return (
    <nav
      aria-label="Main navigation"
      // No bottom safe-area padding here: the fixed wrapper in AppLayout applies
      // the inset ONCE for the player bar + dock.
      className="vx-dock vx-mat-chrome md:hidden"
    >
      <ul className="flex items-stretch justify-around px-1">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to} className="min-w-0 flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              onClick={() => haptic('light')}
              className={({ isActive }) => cn('vx-dock-item', isActive && 'vx-dock-active')}
            >
              {({ isActive }) => (
                <>
                  <span className="vx-dock-pill" aria-hidden><Icon className="w-6 h-6 shrink-0" filled={isActive} /></span>
                  <span className="whitespace-nowrap truncate max-w-full">{t(label)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
