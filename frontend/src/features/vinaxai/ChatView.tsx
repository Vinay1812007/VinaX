/**
 * VinaX AI — the chat at /vinaxai and /vinaxai/c/:id: a header (back to
 * VinaX, the chat's title, the now-playing pill, New chat), the thread in a
 * ~760px column, and the composer. Signed-out visitors never get here: the
 * app's sign-in gate answers first. See docs/ai.md.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { usePageTitle } from '@/hooks/usePageTitle';
import { haptic } from '@/services/native';
import { AiError, getConversation, getModels } from './api';
import { pathTo } from './chatState';
import { Composer, type ComposerHandle } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { NowPlayingPill } from './NowPlayingPill';
import { resetChat, retryReply, sendMessage, stopReply, useChatStore } from './store';
import { ArrowDownIcon, ArrowLeftIcon, NewChatIcon, SparkIcon } from './icons';

/** Markdown made readable aloud: code blocks named, not read; markup characters dropped. */
export function plainText(md: string): string {
  return md.replace(/```[\s\S]*?(```|$)/g, ' (code) ').replace(/[*_`#>|~]+/g, '').replace(/\[(\d+)\]/g, '').replace(/\s+/g, ' ').trim();
}

export function greeting(hour: number, name: string | null): string {
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function Calm({ title, body, action }: { title: string; body: string; action?: ReactNode }): ReactNode {
  return (
    <div className="vx-ai-calm" role="status">
      <SparkIcon className="w-8 h-8" />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ChatView(): ReactNode {
  const { id } = useParams();
  const navigate = useNavigate();
  const account = useAccount();
  const firstName = account?.user.name?.trim().split(/\s+/)[0] ?? null;

  const conversationId = useChatStore((s) => s.conversationId);
  const title = useChatStore((s) => s.title);
  const messages = useChatStore((s) => s.messages);
  const leafId = useChatStore((s) => s.leafId);
  const streaming = useChatStore((s) => s.streaming);
  const replyId = useChatStore((s) => s.replyId);
  const notice = useChatStore((s) => s.notice);
  const finished = useChatStore((s) => s.finished);
  const dispatch = useChatStore((s) => s.dispatch);
  const thread = useMemo(() => pathTo(messages, leafId), [messages, leafId]);

  usePageTitle(title ?? 'VinaX AI');

  const models = useQuery({ queryKey: ['vinaxai', 'models', account?.session ?? ''], queryFn: getModels, staleTime: 60_000, retry: 1 });

  // Open the conversation in the address, unless it is already the one on screen.
  const needLoad = !!id && id !== conversationId;
  const conv = useQuery({ queryKey: ['vinaxai', 'conversation', id], queryFn: () => getConversation(id!), enabled: needLoad, staleTime: 0, gcTime: 0, retry: (n, e) => !(e instanceof AiError && e.status === 404) && n < 1 });
  useEffect(() => {
    if (needLoad && conv.data && conv.data.conversation.id === id) dispatch({ type: 'load', conversation: conv.data.conversation, messages: conv.data.messages });
  }, [needLoad, conv.data, id, dispatch]);

  // /vinaxai is a new chat: clear whatever was open.
  const latest = useRef({ conversationId, streaming });
  latest.current = { conversationId, streaming };
  useEffect(() => {
    if (!id && latest.current.conversationId && !latest.current.streaming) resetChat();
  }, [id]);

  // A new conversation gets its own address once the server names it.
  useEffect(() => {
    if (conversationId && !id) navigate(`/vinaxai/c/${conversationId}`, { replace: true });
  }, [conversationId, id, navigate]);

  const [draft, setDraft] = useState('');
  const composer = useRef<ComposerHandle>(null);
  const send = async () => {
    const text = draft;
    setDraft('');
    haptic('light');
    stick.current = true;
    const out = await sendMessage(text);
    if (!out.ok && out.beforeStart) setDraft((d) => d || text);
  };

  // Follow new output unless the listener scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setShowJump(!near);
  };
  const jump = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setShowJump(false);
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, leafId]);

  // Announce a finished reply (only then) to screen readers.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!finished) return;
    const last = thread[thread.length - 1];
    if (last?.role === 'assistant') setAnnounce(last.error ? last.error.message : `VinaX AI replied: ${plainText(last.text).slice(0, 400)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => { composer.current?.focus(); }, [conversationId]);

  const newChat = () => {
    resetChat();
    setDraft('');
    navigate('/vinaxai');
    composer.current?.focus();
  };

  const header = (
    <header className="vx-ai-header">
      <Link to="/" className="vx-ai-back" aria-label="Back to VinaX">
        <ArrowLeftIcon className="w-5 h-5" />
      </Link>
      <div className="vx-ai-brand">
        <h1 className="vx-ai-wordmark">VinaX AI</h1>
        {title && <span className="vx-ai-title" title={title}>{title}</span>}
      </div>
      <div className="vx-ai-header-end">
        <NowPlayingPill />
        <button type="button" className="vx-ai-new" onClick={newChat} aria-label="New chat" title="New chat">
          <NewChatIcon className="w-5 h-5" />
        </button>
      </div>
    </header>
  );

  let body: ReactNode;
  if (models.isPending) body = <div className="vx-ai-loading" aria-busy="true" />;
  else if (models.isError || !models.data?.configured) body = <Calm title="VinaX AI is unavailable right now" body="Please try again in a little while." action={<button type="button" className="vx-ai-chip" onClick={() => void models.refetch()}>Try again</button>} />;
  else if (!models.data.enabled) body = <Calm title="VinaX AI is taking a break" body="It will be back soon. Your music keeps playing in the meantime." />;
  else if (needLoad && conv.isError) body = <Calm title="This chat isn’t available" body="It may have been deleted, or it belongs to another account." action={<button type="button" className="vx-ai-chip" onClick={newChat}>New chat</button>} />;
  else if (needLoad) body = <div className="vx-ai-loading" aria-busy="true" />;
  else {
    const empty = thread.length === 0;
    body = (
      <>
        <div className="vx-ai-scroll" ref={scroller} onScroll={onScroll}>
          <div className="vx-ai-column">
            {empty ? (
              <div className="vx-ai-empty">
                <SparkIcon className="w-8 h-8" />
                <h2>{greeting(new Date().getHours(), firstName)}</h2>
              </div>
            ) : (
              <section className="vx-ai-thread" aria-label="Conversation">
                {thread.map((m) =>
                  m.role === 'user' ? (
                    <UserMessage key={m.id} message={m} />
                  ) : (
                    <AssistantMessage key={m.id} message={m} live={streaming && m.id === replyId} onRetry={m.parentId && conversationId ? () => void retryReply(m.parentId!) : undefined} />
                  ),
                )}
              </section>
            )}
          </div>
        </div>
        {showJump && (
          <button type="button" className="vx-ai-jump" onClick={jump} aria-label="Jump to the latest message">
            <ArrowDownIcon className="w-4 h-4" />
          </button>
        )}
        <div className="vx-ai-dock">
          <div className="vx-ai-column">
            {notice && (
              <div className="vx-ai-notice" role="alert">
                <span>{notice.message}</span>
                <button type="button" onClick={() => dispatch({ type: 'dismiss' })} aria-label="Dismiss">×</button>
              </div>
            )}
            <Composer ref={composer} value={draft} onChange={setDraft} onSend={() => void send()} onStop={stopReply} streaming={streaming} />
            <p className="vx-ai-footer">VinaX AI can make mistakes. Messages are sent to AI providers to generate replies.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="vx-ai">
      {header}
      <div className="vx-ai-main">{body}</div>
      <div className="sr-only" aria-live="polite">{announce}</div>
    </div>
  );
}
