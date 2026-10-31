/**
 * VinaX AI — the conversation sidebar: New chat, search, Starred, then
 * Recents by day, each with a ⋯ menu (Star, Rename, Delete), and the
 * account with links to Settings and back to VinaX. On a wide screen it is
 * a column that can be collapsed; below 1024px it is a slide-over drawer.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { toast } from '@/store/toastStore';
import { deleteConversation, listConversations, patchConversation } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { groupConversations } from './sidebarGroups';
import { resetChat, useChatStore } from './store';
import { moveFocus, useDismiss } from './useDismiss';
import { ArrowLeftIcon, CloseIcon, DotsIcon, NewChatIcon, PencilIcon, SearchSmallIcon, SidebarIcon, StarIcon, TrashIcon } from './icons';
import type { ConversationSummary } from './types';

export const LIST_KEY = ['vinaxai', 'conversations'] as const;

function RowMenu({ c, onRename, onDelete, onStar }: { c: ConversationSummary; onRename(): void; onDelete(): void; onStar(): void }): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [button, menu]);
  const act = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const item = (label: string, icon: ReactNode, fn: () => void, danger = false) => (
    <div role="menuitem" tabIndex={-1} className={`vx-ai-menu-item${danger ? ' is-danger' : ''}`} onClick={() => act(fn)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(fn); } }}>
      {icon}
      <span>{label}</span>
    </div>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className="vx-ai-row-more"
        aria-label={`Options for ${c.title ?? 'this chat'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => moveFocus(menu.current, '[role="menuitem"]', 'first'));
        }}
      >
        <DotsIcon className="w-4 h-4" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Chat options"
          className="vx-ai-pop vx-ai-row-menu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(menu.current, '[role="menuitem"]', 1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(menu.current, '[role="menuitem"]', -1); }
          }}
        >
          {item(c.starred ? 'Unstar' : 'Star', <StarIcon className="w-4 h-4" filled={c.starred} />, onStar)}
          {item('Rename', <PencilIcon className="w-4 h-4" />, onRename)}
          {item('Delete', <TrashIcon className="w-4 h-4" />, onDelete, true)}
        </div>
      )}
    </>
  );
}

function Row({ c, onNavigate, onDeleteAsk }: { c: ConversationSummary; onNavigate(): void; onDeleteAsk(c: ConversationSummary): void }): ReactNode {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.title ?? '');
  const refresh = () => void qc.invalidateQueries({ queryKey: LIST_KEY });
  const star = () => {
    patchConversation(c.id, { starred: !c.starred }).then(refresh, () => toast('Couldn’t update that chat'));
  };
  const saveName = () => {
    const t = name.replace(/\s+/g, ' ').trim();
    setRenaming(false);
    if (!t || t === c.title) return;
    if (useChatStore.getState().conversationId === c.id) useChatStore.setState({ title: t });
    patchConversation(c.id, { title: t.slice(0, 120) }).then(refresh, () => toast('Couldn’t rename that chat'));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); saveName(); }
    if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); setName(c.title ?? ''); }
  };
  return (
    <li className="vx-ai-row">
      {renaming ? (
        <input className="vx-ai-rename" aria-label="Chat name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} onBlur={saveName} autoFocus maxLength={120} />
      ) : (
        <>
          <NavLink to={`/vinaxai/c/${c.id}`} className={({ isActive }) => `vx-ai-row-link${isActive ? ' is-active' : ''}`} onClick={onNavigate} title={c.title ?? 'New chat'}>
            {c.starred && <StarIcon className="w-3.5 h-3.5 vx-ai-row-star" filled />}
            <span>{c.title ?? 'New chat'}</span>
          </NavLink>
          <RowMenu c={c} onStar={star} onRename={() => { setName(c.title ?? ''); setRenaming(true); }} onDelete={() => onDeleteAsk(c)} />
        </>
      )}
    </li>
  );
}

interface Props {
  /** Close the drawer (phone) after a choice. */
  onNavigate(): void;
  onNewChat(): void;
  /** Collapse the column (wide) or close the drawer (narrow). */
  onCollapse?(): void;
  /** Shown as a slide-over drawer. */
  drawer?: boolean;
}

export function Sidebar({ onNavigate, onNewChat, onCollapse, drawer }: Props): ReactNode {
  const account = useAccount();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, q],
    queryFn: ({ pageParam }) => listConversations({ q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last?.nextCursor ?? null,
    staleTime: 30_000,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => (Array.isArray(p?.items) ? p.items : [])) ?? [], [list.data]);
  const groups = useMemo(() => groupConversations(items), [items]);
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null);

  const remove = async (c: ConversationSummary) => {
    setToDelete(null);
    try {
      await deleteConversation(c.id);
      if (useChatStore.getState().conversationId === c.id) {
        resetChat();
        navigate('/vinaxai');
      }
      toast('Chat deleted');
    } catch {
      toast('Couldn’t delete that chat');
    }
    void qc.invalidateQueries({ queryKey: LIST_KEY });
  };

  const name = account?.user.name ?? 'You';
  return (
    <div className="vx-ai-side-inner">
      <div className="vx-ai-side-head">
        <span className="vx-ai-side-mark">VinaX AI</span>
        {onCollapse && (
          <button type="button" className="vx-ai-icon-btn" onClick={onCollapse} aria-label={drawer ? 'Close chats' : 'Close sidebar'} title={drawer ? 'Close chats' : 'Close sidebar'}>
            {drawer ? <CloseIcon className="w-5 h-5" /> : <SidebarIcon className="w-5 h-5" />}
          </button>
        )}
      </div>
      <button type="button" className="vx-ai-side-new" onClick={onNewChat}>
        <NewChatIcon className="w-5 h-5" />
        <span>New chat</span>
      </button>
      <div className="vx-ai-side-search">
        <SearchSmallIcon className="w-4 h-4" />
        <input type="search" aria-label="Search chats" placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <nav className="vx-ai-side-list" aria-label="Chats">
        {list.isPending && <p className="vx-ai-side-note">Loading chats…</p>}
        {list.isError && <p className="vx-ai-side-note">Couldn’t load your chats.</p>}
        {list.isSuccess && !items.length && <p className="vx-ai-side-note">{q ? 'No chats match that.' : 'Your chats will appear here.'}</p>}
        {q
          ? items.length > 0 && (
            <section aria-label="Search results">
              <h3 className="vx-ai-side-h">Results</h3>
              <ul>{items.map((c) => <Row key={c.id} c={c} onNavigate={onNavigate} onDeleteAsk={setToDelete} />)}</ul>
            </section>
          )
          : groups.map((g) => (
            <section key={g.label} aria-label={g.label === 'Starred' ? 'Starred' : `Recents: ${g.label}`}>
              <h3 className="vx-ai-side-h">{g.label}</h3>
              <ul>{g.items.map((c) => <Row key={c.id} c={c} onNavigate={onNavigate} onDeleteAsk={setToDelete} />)}</ul>
            </section>
          ))}
        {list.hasNextPage && (
          <button type="button" className="vx-ai-side-more" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </nav>
      <div className="vx-ai-side-foot">
        <div className="vx-ai-me">
          {account?.user.picture ? <img src={account.user.picture} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : <span className="vx-ai-me-initial" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>}
          <span className="vx-ai-me-name">{name}</span>
        </div>
        <div className="vx-ai-side-links">
          <Link to="/settings" onClick={onNavigate}>Settings</Link>
          <Link to="/" onClick={onNavigate} className="vx-ai-side-back">
            <ArrowLeftIcon className="w-4 h-4" /> Back to VinaX
          </Link>
        </div>
      </div>
      {toDelete && (
        <ConfirmDialog
          title="Delete this chat?"
          body={`“${toDelete.title ?? 'New chat'}” and all its messages will be deleted. This can’t be undone.`}
          confirm="Delete"
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove(toDelete)}
        />
      )}
    </div>
  );
}
