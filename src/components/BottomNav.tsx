import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { CompassIcon, HomeIcon, LibraryIcon, SearchIcon, SparkleIcon } from './Icons';
import { haptic } from '@/services/native';
import { useT } from '@/i18n';

const items = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/discover', label: 'Discover', icon: CompassIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/library', label: 'Library', icon: LibraryIcon },
  { to: '/VinaXAI', label: 'VinaX AI', icon: SparkleIcon, ai: true as const },
];

/** Floating dock — a detached pill bar. The active tab blooms into a labeled
 *  pill tinted by the current artwork's living color (--art). */
export function BottomNav() {
  const t = useT();
  return (
    <nav
      aria-label="Main navigation"
      className="vx-dock md:hidden mx-4 mb-[max(0.6rem,var(--safe-bottom))] rounded-[28px] glass-navbar shadow-lift overflow-hidden"
    >
      <ul className="flex items-center justify-between px-2 py-1.5">
        {items.map(({ to, label, icon: Icon, ai }) => (
          <li key={to} className="min-w-0">
            <NavLink
              to={to}
              end={to === '/'}
              onClick={() => haptic('light')}
              className={({ isActive }) =>
                cn(
                  'vx-dock-item flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold',
                  isActive ? 'vx-dock-active' : 'text-ink-400 active:text-ink-200',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {ai ? (
                    <span className="vx-ai-pulse inline-flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </span>
                  ) : (
                    <Icon className="w-5 h-5 shrink-0" />
                  )}
                  {isActive && <span className="whitespace-nowrap truncate">{t(label)}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
