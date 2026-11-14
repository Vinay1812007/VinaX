import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { DOCK_NAV } from '@/constants/nav';
import { haptic } from '@/services/native';
import { useT } from '@/i18n';

/** The phone tab bar: each tab an icon over its label. 2.0 — Home, Search,
 *  Library and VinaX AI; 1.14.4 — Flow in the middle (constants/nav.ts
 *  DOCK_NAV); a solid bar whose active tab is the accent colour. */
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
        {DOCK_NAV.map(({ to, label, icon: Icon }) => (
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
