import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MusicIcon, PlusIcon, SearchIcon, SparkleIcon, XIcon } from '@/components/Icons';
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
  /** 9.1.0 — a chat that is never written to this device. */
  newTemporaryChat: () => void;
  /** 9.1.0 — open the project sheet (create, edit, or assign this chat). */
  openProjects: () => void;
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
  /** 11.3 — chats writing a reply right now (several can at once). */
  streaming?: ReadonlySet<string>;
}

const Row = memo(function Row({
  c,
  active,
  writing = false,
  renaming,
  onRenaming,
  handlers,
}: {
  c: Conversation;
  active: boolean;
  writing?: boolean;
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
          className="ai-field ai-side-rename flex-1 min-w-0 outline-none"
        />
      ) : (
        <button
          type="button"
          className="ai-side-open"
          aria-current={active ? 'page' : undefined}
          onClick={() => handlers.open(c.id)}
          onDoubleClick={() => onRenaming(c.id)}
        >
          <span className="ai-side-title">{c.title}</span>
          {writing ? (
            <span className="ai-side-writing" role="status" aria-label="Writing a reply" title="Writing a reply">
              <span aria-hidden />
              <span aria-hidden />
              <span aria-hidden />
            </span>
          ) : (
            <span className="ai-side-time">{relTime(c.updatedAt)}</span>
          )}
        </button>
      )}
      <span className="ai-side-actions flex items-center shrink-0">
        <button type="button" onClick={() => onRenaming(c.id)} aria-label="Rename chat" title="Rename" className="ai-icon-btn ai-side-act">
          <PencilIcon className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => handlers.remove(c.id)} aria-label="Delete chat" title="Delete" className="ai-icon-btn ai-side-act ai-side-act-danger">
          <TrashIcon className="w-4 h-4" />
        </button>
      </span>
      <button
        type="button"
        onClick={() => handlers.togglePin(c.id)}
        aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'}
        title={c.pinned ? 'Unpin' : 'Pin'}
        aria-pressed={!!c.pinned}
        className={cn('ai-icon-btn ai-side-act', c.pinned ? 'ai-side-pinned' : 'ai-side-actions')}
      >
        <StarIcon className="w-4 h-4" filled={!!c.pinned} />
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
export function Sidebar({ chats, activeId, collapsed, onCollapse, mobileOpen, onCloseMobile, handlers, streaming }: SidebarProps): ReactNode {
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
  // which stays cheap for hundreds of chats; the rows themselves are memoised.
  const groups = useMemo(() => groupChats(chats, query), [chats, query]);

  return (
    <>
      <aside
        ref={ref}
        aria-label="Chats"
        className={cn('ai-sidebar ai-panel', mobileOpen && 'ai-sidebar-open', collapsed && 'ai-sidebar-collapsed')}
      >
        <div className="ai-side-head">
          <p className="ai-side-brand">
            <span className="ai-mark" aria-hidden>
              <SparkleIcon filled />
            </span>
            VinaX AI
          </p>
          {desktop ? (
            <button type="button" onClick={onCollapse} aria-label="Hide chat list" title="Hide chat list (Ctrl/⌘+B)" className="ai-icon-btn">
              <PanelIcon className="w-[18px] h-[18px]" />
            </button>
          ) : (
            <button type="button" onClick={onCloseMobile} aria-label="Close menu" className="ai-icon-btn">
              <XIcon className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="ai-side-tools">
          <button type="button" onClick={handlers.newChat} className="ai-side-new" title="New chat (Ctrl/⌘+K)">
            <PlusIcon className="w-5 h-5" /> New chat
          </button>
          {/* 9.1.0 — nothing from this chat is stored on the device: it is gone
              when the tab is, and it is never part of an export. */}
          <button
            type="button"
            onClick={handlers.newTemporaryChat}
            className="ai-side-temp"
            title="Temporary chat — never saved on this device"
          >
            Temporary chat
          </button>
          {/* 9.1.0 — projects: standing instructions and reference files that
              every chat inside one starts with. */}
          <button type="button" onClick={handlers.openProjects} className="ai-side-temp" title="Projects — instructions and files a group of chats shares">
            Projects
          </button>
          <label className="ai-side-search">
            <SearchIcon className="w-4 h-4 shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
          </label>
        </div>
        <nav className="ai-side-list" aria-label="Chat history">
          {groups.length === 0 && <p className="ai-side-empty">{query ? 'No chats match that search.' : 'No chats yet.'}</p>}
          {groups.map(([label, list]) => (
            <section key={label} aria-label={label}>
              <h2 className="ai-side-heading">{label}</h2>
              <ul>
                {list.map((c) => (
                  <Row key={c.id} c={c} active={c.id === activeId} writing={!!streaming?.has(c.id)} renaming={renaming === c.id} onRenaming={setRenaming} handlers={handlers} />
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="ai-side-foot">
          <Link to="/" className="ai-side-new" aria-label="Music">
            <MusicIcon className="w-5 h-5" /> Music
          </Link>
        </div>
      </aside>
      {mobileOpen && <button type="button" aria-label="Close menu" tabIndex={-1} className="ai-scrim ai-below-md" onClick={onCloseMobile} />}
    </>
  );
}
