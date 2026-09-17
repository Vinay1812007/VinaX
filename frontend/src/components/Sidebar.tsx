import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSettingsStore } from '@/store/settingsStore';
import { PRIMARY_NAV } from '@/constants/nav';
import { DISPLAY_VERSION } from '@/constants/version';
import { useT } from '@/i18n';
import { ChevronDownIcon } from './Icons';


export function Sidebar() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggle = useSettingsStore((s) => s.toggleSidebar);
  const t = useT();

  return (
    <aside
      className={cn(
        'vx-sidebar hidden md:flex flex-col shrink-0 glass-sidebar overflow-y-auto overflow-x-hidden no-scrollbar sticky top-0 max-h-dvh pb-24 transition-[width] duration-200 ease-out',
        collapsed ? 'w-[4.5rem]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex items-center py-5',
          collapsed ? 'justify-center px-2' : 'justify-between px-5',
        )}
      >
        <NavLink
          to="/"
          className="vx-brand flex items-center gap-2.5 min-w-0"
          aria-label="VinaX home"
        >
          <img src="/icons/icon.svg" alt="" className="w-8 h-8 rounded-lg shrink-0" />
          {!collapsed && (
            <span className="text-xl font-bold tracking-tight truncate text-ink-100">VinaX</span>
          )}
        </NavLink>
        {!collapsed && (
          <button
            onClick={toggle}
            aria-label="Collapse sidebar"
            title="Collapse"
            className="shrink-0 p-1.5 rounded-lg text-ink-400 hover:text-ink-100 hover:bg-ink-800"
          >
            <ChevronDownIcon className="w-5 h-5 rotate-90" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={toggle}
          aria-label="Expand sidebar"
          title="Expand"
          className="mx-auto mb-2 p-1.5 rounded-lg text-ink-400 hover:text-ink-100 hover:bg-ink-800"
        >
          <ChevronDownIcon className="w-5 h-5 -rotate-90" />
        </button>
      )}

      <nav aria-label="Main navigation" className={cn('flex-1 pb-4', collapsed ? 'px-2' : 'px-3')}>
        <ul className="space-y-1">
          {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} end={to === '/'} title={collapsed ? t(label) : undefined} aria-label={collapsed ? t(label) : undefined}
                className={({ isActive }) => cn('vx-nav-link', collapsed && 'justify-center', isActive && 'vx-nav-active')}>
                <Icon className="w-5 h-5 shrink-0" />{!collapsed && <span>{t(label)}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
        {!collapsed && <div className="vx-sidebar-library">
          <p className="vx-eyebrow">Your collection</p>
          <NavLink to="/favorites">Favorites <span>♡</span></NavLink>
          <NavLink to="/history">Recently played <span>↗</span></NavLink>
          <NavLink to="/offline">Downloads <span>↓</span></NavLink>
          <p className="text-meta text-ink-400 mt-6">A space for your music.<br />No account needed.</p>
        </div>}
      </nav>

      {!collapsed && (
        <div className="vx-sidebar-footer mx-3 mb-3 mt-2 flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-glass bg-[var(--tile)]">
          <img src="/icons/icon.svg" alt="" className="w-6 h-6 rounded-md shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="text-[11.5px] font-semibold text-ink-200 truncate">
              {DISPLAY_VERSION}
            </div>
            <div className="text-[10px] text-ink-400 truncate">no account · private</div>
          </div>
        </div>
      )}
    </aside>
  );
}
