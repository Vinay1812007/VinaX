import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/States';
import { getSharedChat, SocialError } from '@/services/social/api';
import { SparkleIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

/**
 * 15.0 — /ai/shared/<id>: a VinaX AI conversation someone chose to share.
 * Read-only, text only, open to anyone with the link for 90 days. The
 * sharer writes the whole copy, so it renders as PLAIN TEXT — never the
 * chat's rich renderer (HTML previews, Run, diagrams) — and the replies are
 * labelled as shared, not as VinaX AI speaking on this page.
 */
export default function SharedChatPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['shared-chat', id], queryFn: () => getSharedChat(id), enabled: !!id, retry: false, staleTime: 60_000 });
  const chat = q.data;
  usePageTitle(chat?.title ?? 'Shared chat');
  if (q.isLoading) return <div className="vx-sec"><p className="text-ink-400 p-6">Loading…</p></div>;
  if (!chat) {
    const gone = q.error instanceof SocialError && q.error.code === 'not_found';
    return <EmptyState title="This chat is not here" message={gone ? 'The link has expired, was removed, or was mistyped.' : 'Could not load it right now.'} action={<Link to="/VinaXAI" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Open VinaX AI</Link>} />;
  }
  const when = new Date(chat.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="vx-sec">
      <PageHeader title={chat.title ?? 'A VinaX AI chat'} subtitle={`Shared by a listener ${when}${chat.model ? ` · model: ${chat.model}` : ''} · read-only`} />
      <ol className="vx-shared-chat" aria-label="Conversation">
        {chat.messages.map((m, i) => (
          <li key={i} className={m.role === 'user' ? 'vx-shared-msg is-user' : 'vx-shared-msg is-assistant'}>
            <span className="vx-shared-who">{m.role === 'user' ? 'Asked' : <><SparkleIcon className="w-3.5 h-3.5" /> Reply, as shared</>}</span>
            <p className="vx-shared-text">{m.content}</p>
          </li>
        ))}
      </ol>
      <p className="vx-lt-foot mt-6">Want to ask your own? <Link to="/VinaXAI" className="font-semibold text-ember-400 hover:underline">Open VinaX AI</Link>.</p>
    </div>
  );
}
