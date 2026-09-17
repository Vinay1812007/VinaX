import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, SearchIcon, SparkleIcon, XIcon } from '@/components/Icons';
import { PencilIcon, StarIcon } from '@/components/ai/AiExtras';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { cn } from '@/utils/cn';
import { PanelIcon, TrashIcon } from './icons';
import { groupChats, relTime } from './storage';
import { useMediaQuery } from './useMediaQuery';
import type { Conversation } from './types';

export type SidebarHandlers = {
  newChat: () => void;
  open: (id: string) => void;
  rename: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
};

export interface SidebarProps {
  chats: Conversation[];
  activeId: string;
  /** Desktop: folded away (remembered). */
  collapsed: boolean;
  onCollapse: () => void;
  /** Phones: the slide-over is open. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  handlers: SidebarHandlers;
}

const Row = memo(function Row({
  c,
  active,
  renaming,
  onRenaming,
  handlers,
}: {
  c: Conversation;
  active: boolean;
  renaming: boolean;
  onRenaming: (id: string | null) => void;
  handlers: SidebarHandlers;
}): ReactNode {
  return (
    <li className={cn('ai-side-row relative', active && 'ai-side-row-on')}>
      {renaming ? (
        <input
          autoFocus
          defaultValue={c.title}
          aria-label="Chat name"
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handlers.rename(c.id, (e.target as HTMLInputElement).value);
              onRenaming(null);
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              onRenaming(null);
            }
          }}
          onBlur={(e) => {
            handlers.rename(c.id, e.target.value);
            onRenaming(null);
          }}
          className="ai-field flex-1 min-w-0 px-2 py-1 text-[13px] font-semibold ai-t1 outline-none"
        />
      ) : (
        <button
          type="button"
          className="ai-side-open"
          aria-current={active ? 'page' : undefined}
          onClick={() => handlers.open(c.id)}
          onDoubleClick={() => onRenaming(c.id)}
        >
          <span className="block truncate text-[13px] font-semibold leading-tight">{c.title}</span>
          <span className="block text-[11px] ai-t3 leading-tight mt-0.5 font-normal">{relTime(c.updatedAt)}</span>
        </button>
      )}
      <span className="ai-side-actions flex items-center shrink-0">
        <button type="button" onClick={() => onRenaming(c.id)} aria-label="Rename chat" title="Rename" className="ai-icon-btn w-7 h-7 ai-t3">
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => handlers.remove(c.id)} aria-label="Delete chat" title="Delete" className="ai-icon-btn w-7 h-7 ai-t3 hover:text-red-400">
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </span>
      <button
        type="button"
        onClick={() => handlers.togglePin(c.id)}
        aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'}
        title={c.pinned ? 'Unpin' : 'Pin'}
        aria-pressed={!!c.pinned}
        className={cn('ai-icon-btn w-7 h-7 shrink-0', c.pinned ? 'text-ember-400' : 'ai-side-actions ai-t3')}
      >
        <StarIcon className="w-3.5 h-3.5" filled={!!c.pinned} />
      </button>
    </li>
  );
});

/**
 * v7.1 — the chat list. On a desktop it is a column that folds away (the page
 * remembers); on a phone the same element is a slide-over with a focus trap,
 * Escape, and hardware-back close. New chat first, then search, then threads
 * grouped by when they were last touched.
 */
export function Sidebar({ chats, activeId, collapsed, onCollapse, mobileOpen, onCloseMobile, handlers }: SidebarProps): ReactNode {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  // Rendered, not CSS-hidden, per layout: the focus trap walks every
  // focusable in the panel, and a display:none button at either end of that
  // list would swallow Tab.
  const desktop = useMediaQuery('(min-width: 768px)');
  useFocusTrap(ref, mobileOpen, onCloseMobile);
  useDismissOnBack(mobileOpen, onCloseMobile);

  // A phone slide-over left open must not survive a rotate / resize into the
  // desktop layout, where it would keep trapping focus in a static column.
  useEffect(() => {
    if (desktop && mobileOpen) onCloseMobile();
  }, [desktop, mobileOpen, onCloseMobile]);

  // Re-grouped whenever `chats` changes (a streaming reply does that often),
  // which is cheap for ≤ 50 chats; the rows themselves are memoised.
  const groups = useMemo(() => groupChats(chats, query), [chats, query]);

  return (
    <>
      <aside
        ref={ref}
        aria-label="Chats"
        className={cn('ai-sidebar ai-panel', mobileOpen && 'ai-sidebar-open', collapsed && 'ai-sidebar-collapsed')}
      >
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
          <SparkleIcon className="w-[18px] h-[18px] shrink-0 text-ember-400" />
          <p className="text-[14px] font-bold tracking-tight ai-t1 flex-1 min-w-0">VinaX AI</p>
          {desktop ? (
            <button type="button" onClick={onCollapse} aria-label="Hide chat list" title="Hide chat list (Ctrl/⌘+B)" className="ai-icon-btn -mr-1">
              <PanelIcon className="w-[18px] h-[18px]" />
            </button>
          ) : (
            <button type="button" onClick={onCloseMobile} aria-label="Close menu" className="ai-icon-btn -mr-1">
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="px-2.5">
          <button type="button" onClick={handlers.newChat} className="ai-btn w-full justify-start" title="New chat (Ctrl/⌘+K)">
            <PlusIcon className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="px-2.5 pt-2 pb-1">
          <label className="ai-field flex items-center gap-2 px-2.5 py-1.5 ai-t3 focus-within:ai-t2">
            <SearchIcon className="w-3.5 h-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full min-w-0 bg-transparent text-[13px] outline-none ai-t1 placeholder:opacity-60"
            />
          </label>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label="Chat history">
          {groups.length === 0 && <p className="px-2.5 pt-4 text-[12px] ai-t3">{query ? 'No chats match that search.' : 'No chats yet.'}</p>}
          {groups.map(([label, list]) => (
            <section key={label} aria-label={label}>
              <h2 className="ai-eyebrow px-2.5 pt-4 pb-1 flex items-center gap-1.5">
                {label === 'Pinned' && <StarIcon className="w-3 h-3" filled />}
                {label}
              </h2>
              <ul>
                {list.map((c) => (
                  <Row key={c.id} c={c} active={c.id === activeId} renaming={renaming === c.id} onRenaming={setRenaming} handlers={handlers} />
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t ai-hairline">
          <Link to="/" className="ai-chip py-1.5 ai-t2" aria-label="Music">
            <span aria-hidden>♪</span> Music
          </Link>
        </div>
      </aside>
      {mobileOpen && <button type="button" aria-label="Close menu" tabIndex={-1} className="ai-scrim ai-below-md" onClick={onCloseMobile} />}
    </>
  );
}
