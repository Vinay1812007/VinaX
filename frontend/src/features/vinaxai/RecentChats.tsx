/**
 * VinaX AI — "Your recent chats" under the greeting of a new chat, the way
 * Claude's home shows them: the latest six as cards, and a link to every
 * chat. Nothing shows while the list loads or when there are none.
 */
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listConversations } from './api';
import { ChatsIcon, ChevronIcon, StarIcon } from './icons';

export const RECENT_KEY = ['vinaxai', 'conversations', 'recent'] as const;
export const RECENT_MAX = 6;

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", else the date. */
export function agoLabel(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function RecentChats(): ReactNode {
  const recent = useQuery({ queryKey: RECENT_KEY, queryFn: () => listConversations({}), staleTime: 30_000 });
  const items = (recent.data?.items ?? []).slice(0, RECENT_MAX);
  if (!items.length) return null;
  return (
    <section className="vx-ai-recent" aria-labelledby="vx-ai-recent-h">
      <div className="vx-ai-recent-head">
        <h3 id="vx-ai-recent-h"><ChatsIcon className="w-4 h-4" /> Your recent chats</h3>
        <Link to="/vinaxai/chats" className="vx-ai-recent-all">All chats <ChevronIcon className="w-3.5 h-3.5" /></Link>
      </div>
      <ul className="vx-ai-recent-grid">
        {items.map((c) => (
          <li key={c.id}>
            <Link to={`/vinaxai/c/${c.id}`} className="vx-ai-recent-card">
              <span className="vx-ai-recent-title">
                {c.starred && <StarIcon className="w-3.5 h-3.5 vx-ai-row-star" filled />}
                <span>{c.title ?? 'New chat'}</span>
              </span>
              <span className="vx-ai-recent-when">{agoLabel(c.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
