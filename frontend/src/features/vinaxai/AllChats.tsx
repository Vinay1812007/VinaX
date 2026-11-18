/**
 * VinaX AI — every chat, at /vinaxai/chats (the sidebar's Chats, Claude's
 * recents page): a search box, the chats newest first with a checkbox each,
 * Select all, and Delete for the selection (one request:
 * DELETE /api/ai/conversations). Loaded only when the page opens; shown
 * inside the chat frame (ChatView), so the sidebar and header stay.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/store/toastStore';
import { deleteConversations, listConversations } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { ChatsIcon, SearchSmallIcon, StarIcon, TrashIcon } from './icons';
import { agoLabel } from './RecentChats';
import { LIST_KEY } from './Sidebar';
import { ListSkeleton } from './Skeleton';
import { resetChat, useChatStore } from './store';

export default function AllChats(): ReactNode {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, 'all', q],
    queryFn: ({ pageParam }) => listConversations({ q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last?.nextCursor ?? null,
    staleTime: 30_000,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => (Array.isArray(p?.items) ? p.items : [])) ?? [], [list.data]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // A chat that left the list leaves the selection.
  useEffect(() => {
    setPicked((p) => {
      const keep = new Set([...p].filter((id) => items.some((c) => c.id === id)));
      return keep.size === p.size ? p : keep;
    });
  }, [items]);
  const allPicked = items.length > 0 && items.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(items.map((c) => c.id)));

  const remove = async () => {
    const ids = [...picked];
    setAsking(false);
    setBusy(true);
    try {
      const r = await deleteConversations({ ids });
      toast(r.deleted === 1 ? 'Chat deleted' : `${r.deleted} chats deleted`);
      if (ids.includes(useChatStore.getState().conversationId ?? '')) { resetChat(); navigate('/vinaxai'); }
      setPicked(new Set());
    } catch {
      toast('Couldn’t delete those chats');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    }
  };

  return (
    <div className="vx-ai-scroll">
      <div className="vx-ai-column vx-ai-proj vx-ai-chats">
        <div className="vx-ai-proj-top">
          <h2>Chats</h2>
          <div className="vx-ai-side-search vx-ai-chats-search">
            <SearchSmallIcon className="w-4 h-4" />
            <input type="search" aria-label="Search all chats" placeholder="Search your chats" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {items.length > 0 && (
          <div className="vx-ai-chats-bar" role="toolbar" aria-label="Selection">
            <label className="vx-ai-check">
              <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all chats" />
              <span>{picked.size ? `${picked.size} selected` : 'Select all'}</span>
            </label>
            {picked.size > 0 && (
              <button type="button" className="vx-ai-chip is-danger" onClick={() => setAsking(true)} disabled={busy} aria-haspopup="dialog">
                <TrashIcon className="w-4 h-4" /> Delete {picked.size === 1 ? 'chat' : `${picked.size} chats`}
              </button>
            )}
          </div>
        )}
        {list.isPending && <ListSkeleton label="Loading chats…" />}
        {list.isError && <p className="vx-ai-side-note">Couldn’t load your chats.</p>}
        {list.isSuccess && !items.length && (
          <div className="vx-ai-calm" role="status">
            <ChatsIcon className="w-8 h-8" />
            <h2>{q ? 'No chats match that' : 'No chats yet'}</h2>
            <p>{q ? 'Try another word from the chat’s title or its messages.' : 'Every chat you start with VinaX AI will be listed here.'}</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="vx-ai-chats-list" aria-label="All chats">
            {items.map((c) => (
              <li key={c.id} className={picked.has(c.id) ? 'is-picked' : undefined}>
                <input type="checkbox" className="vx-ai-chats-pick" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.title ?? 'New chat'}`} />
                <Link to={`/vinaxai/c/${c.id}`} className="vx-ai-chats-link">
                  <span className="vx-ai-chats-title">
                    {c.starred && <StarIcon className="w-3.5 h-3.5 vx-ai-row-star" filled />}
                    <span>{c.title ?? 'New chat'}</span>
                  </span>
                  <span className="vx-ai-chats-when">{agoLabel(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <button type="button" className="vx-ai-chip vx-ai-chats-more" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
      {asking && (
        <ConfirmDialog
          title={picked.size === 1 ? 'Delete this chat?' : `Delete ${picked.size} chats?`}
          body={`${picked.size === 1 ? 'The chat' : 'These chats'} and all ${picked.size === 1 ? 'its' : 'their'} messages will be deleted, and any shared links will stop working. This can’t be undone.`}
          confirm="Delete"
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
