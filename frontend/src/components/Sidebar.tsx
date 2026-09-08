import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSettingsStore } from '@/store/settingsStore';
import { NAV_GROUPS } from '@/constants/nav';
import { flagOn, useFeatureFlags } from '@/features/home/useAppConfig';
import { DISPLAY_VERSION } from '@/constants/version';
import { useT } from '@/i18n';
import { ChevronDownIcon } from './Icons';

const groups = NAV_GROUPS;

export function Sidebar() {
  // v5.13.0 — admin kill-switches (Settings → Feature Flags in the console).
  const flags = useFeatureFlags();
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggle = useSettingsStore((s) => s.toggleSidebar);
  const t = useT();

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col shrink-0 my-2 ml-2 rounded-lg glass-sidebar overflow-y-auto overflow-x-hidden no-scrollbar sticky top-0 max-h-dvh transition-[width] duration-200 ease-out',
        collapsed ? 'w-[4.5rem]' : 'w-60',
      )}
    >
      <div className={cn('flex items-center py-5', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        <NavLink to="/" className="vx-brand flex items-center gap-2.5 min-w-0" aria-label="VinaX home">
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

      <nav aria-label="Main navigation" className={cn('flex-1 pb-32', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((g, i) => (
          <Fragment key={g.label}>
            {i > 0 && <div className="vx-sidebar-divider mx-3 my-3 h-px bg-white/5" />}
            <div>
              {!collapsed && (
                <p className="vx-sidebar-eyebrow px-2 mb-1.5 text-[11px] font-semibold uppercase text-ink-400">{t(g.label)}</p>
              )}
              <ul className="space-y-0.5">
                {g.items.filter(({ to }) => to !== '/together' || flagOn(flags, 'listenTogether')).map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      aria-label={label}
                      title={collapsed ? t(label) : undefined}
                      className={({ isActive }) =>
                        cn(
                          // v5.9.0 nav: bold grey that turns white when
                          // active or hovered — no pills, no accent bar.
                          // v5.18.0 refresh: the active item sits on a soft tile with an
                          // accent bar; the rest stay quiet until hovered.
                          'relative flex items-center rounded-xl text-[14px] font-bold transition-colors',
                          collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3.5 px-3 py-2',
                          isActive ? 'vx-nav-active bg-[var(--tile)] text-ink-100' : 'text-ink-300 hover:text-ink-100 hover:bg-[var(--tile)]',
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
        <div className="vx-sidebar-footer mx-3 mb-3 mt-2 flex items-center gap-2 px-3 py-2.5 rounded-2xl border border-glass bg-[var(--tile)]">
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
