import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { CompassIcon, DownloadIcon, HomeIcon, LibraryIcon, SearchIcon, SparkleIcon } from './Icons';
import { haptic, isNativePlatform } from '@/services/native';
import { useT } from '@/i18n';

interface DockItem {
  to: string;
  label: string;
  icon: typeof HomeIcon;
  ai?: true;
}

const items: DockItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/discover', label: 'Discover', icon: CompassIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  // v5.5.2 — Android app: downloads are the whole point of the native shell,
  // so they get a first-class dock seat there. The web dock keeps its tighter
  // five seats (browser listeners stream; the Downloads screen stays reachable
  // from Library).
  ...(isNativePlatform() ? [{ to: '/offline', label: 'Downloads', icon: DownloadIcon }] : []),
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
      className="vx-dock md:hidden mx-4 mb-[max(0.6rem,var(--safe-bottom))] rounded-3xl glass-navbar shadow-lift overflow-hidden"
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
                  {isActive ? (
                    <span className="whitespace-nowrap truncate">{t(label)}</span>
                  ) : (
                    /* Inactive tabs show only the icon — give screen readers
                       the name anyway (audit P2-22). */
                    <span className="sr-only">{t(label)}</span>
                  )}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
