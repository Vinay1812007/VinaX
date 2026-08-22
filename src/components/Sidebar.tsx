import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSettingsStore } from '@/store/settingsStore';
import { NAV_GROUPS } from '@/constants/nav';
import { DISPLAY_VERSION } from '@/constants/version';
import { useT } from '@/i18n';
import { ChevronDownIcon } from './Icons';

const groups = NAV_GROUPS;

export function Sidebar() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggle = useSettingsStore((s) => s.toggleSidebar);
  const t = useT();

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col shrink-0 my-3 ml-3 rounded-3xl glass-sidebar overflow-y-auto overflow-x-hidden transition-[width] duration-200 ease-out',
        collapsed ? 'w-[4.5rem]' : 'w-60',
      )}
    >
      <div className={cn('flex items-center py-5', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        <NavLink to="/" className="flex items-center gap-2.5 min-w-0" aria-label="VinaX home">
          <img src="/icons/icon.svg" alt="" className="w-8 h-8 rounded-lg shrink-0" />
          {!collapsed && (
            <span className="text-xl font-bold tracking-tight truncate">
              <span className="bg-gradient-to-r from-ember-400 to-tide-400 bg-clip-text text-transparent">VinaX</span>
              <span className="text-ember-500">.</span>
            </span>
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

      <nav aria-label="Main navigation" className={cn('flex-1 pb-32', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((g, i) => (
          <Fragment key={g.label}>
            {i > 0 && <div className="vx-sidebar-divider mx-3 my-3 h-px bg-white/5" />}
            <div>
              {!collapsed && (
                <p className="vx-sidebar-eyebrow px-2 mb-1.5 text-[11px] font-semibold uppercase text-ink-400">{t(g.label)}</p>
              )}
              <ul className="space-y-0.5">
                {g.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      aria-label={label}
                      title={collapsed ? t(label) : undefined}
                      className={({ isActive }) =>
                        cn(
                          'relative flex items-center rounded-2xl text-[13.5px] transition-all',
                          collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2.5',
                          isActive
                            ? 'nav-pill-active text-ember-300 font-semibold'
                            : cn(
                                'font-medium text-ink-200 hover:text-ink-100',
                                collapsed
                                  ? 'hover:bg-ink-800/40'
                                  : 'hover:bg-ink-800/40 motion-safe:hover:translate-x-0.5',
                              ),
                          isActive && !collapsed &&
                            'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-ember-500',
                        )
                      }
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      {!collapsed && t(label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </Fragment>
        ))}
      </nav>

      {!collapsed && (
        <div className="vx-sidebar-footer mx-3 mb-3 mt-2 flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-white/[0.04] bg-white/[0.02]">
          <img src="/icons/icon.svg" alt="" className="w-6 h-6 rounded-md shrink-0" />
          <div className="min-w-0 leading-tight">
            <div className="text-[11.5px] font-semibold text-ink-200 truncate">{DISPLAY_VERSION}</div>
            <div className="text-[10px] text-ink-400 truncate">no account · private</div>
          </div>
        </div>
      )}
    </aside>
  );
}
