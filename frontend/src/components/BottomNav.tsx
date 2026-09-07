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

/** v5.9.0 — Spotify's tab bar: a solid black strip fading up from the
 *  bottom edge, every tab an icon with its label under it, the active one
 *  white and the rest grey. */
export function BottomNav() {
  const t = useT();
  return (
    <nav
      aria-label="Main navigation"
      className="vx-dock md:hidden bg-gradient-to-t from-black via-black/95 to-black/70 pb-[var(--safe-bottom)]"
    >
      <ul className="flex items-stretch justify-around px-1 pt-1.5 pb-1">
        {items.map(({ to, label, icon: Icon, ai }) => (
          <li key={to} className="min-w-0 flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              onClick={() => haptic('light')}
              className={({ isActive }) =>
                cn(
                  'vx-dock-item flex flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-semibold',
                  isActive ? 'vx-dock-active text-ink-100' : 'text-ink-300 active:text-ink-100',
                )
              }
            >
              {ai ? (
                <span className="vx-ai-pulse inline-flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6" />
                </span>
              ) : (
                <Icon className="w-6 h-6 shrink-0" />
              )}
              <span className="whitespace-nowrap truncate max-w-full">{t(label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
