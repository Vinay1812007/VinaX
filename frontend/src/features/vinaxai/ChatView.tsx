/**
 * VinaX AI — the chat at /vinaxai and /vinaxai/c/:id.
 *
 *   wide (≥1024px):  [ sidebar 260px, collapsible ] [ header · thread · composer ]
 *   narrow:          [ header ☰ · thread · composer ]  + the sidebar as a drawer
 *
 * A new chat opens on a greeting with the composer in the middle and four
 * suggestion chips that fill in a starter (they never send). Signed-out
 * visitors never get here: the app's sign-in gate answers first.
 * See docs/ai.md.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { haptic } from '@/services/native';
import { AiError, getConversation, getModels } from './api';
import { pathTo } from './chatState';
import { Composer, type ComposerHandle } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { NowPlayingPill } from './NowPlayingPill';
import { usePrefs } from './prefs';
import { Sidebar } from './Sidebar';
import { continueReply, resetChat, retryReply, sendMessage, stopReply, useChatStore } from './store';
import { useDismiss } from './useDismiss';
import { ArrowDownIcon, MenuIcon, NewChatIcon, SidebarIcon, SparkIcon } from './icons';

/** Markdown made readable aloud: code blocks named, not read; markup characters dropped. */
export function plainText(md: string): string {
  return md.replace(/```[\s\S]*?(```|$)/g, ' (code) ').replace(/[*_`#>|~]+/g, '').replace(/\[(\d+)\]/g, '').replace(/\s+/g, ' ').trim();
}

export function greeting(hour: number, name: string | null): string {
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** The empty state's chips: each fills the composer with a starter, never sends. */
export const STARTERS: Array<{ label: string; text: string }> = [
  { label: 'Write', text: 'Help me write ' },
  { label: 'Learn', text: 'Explain in simple terms how ' },
  { label: 'Code', text: 'Help me write code that ' },
  { label: 'Music', text: 'Recommend songs like ' },
];

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

/** Keeps the composer above an on-screen keyboard that does not resize the page (visualViewport). */
function useKeyboardInset(el: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const node = el.current;
    if (!vv || !node) return;
    const apply = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      node.style.setProperty('--vx-ai-kb', `${inset}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [el]);
}

export function ChatView(): ReactNode {
  const { id } = useParams();
  const navigate = useNavigate();
  const account = useAccount();
  const firstName = account?.user.name?.trim().split(/\s+/)[0] ?? null;
  const wide = useMediaQuery('(min-width: 1024px)');
  const prefs = usePrefs();

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
  const pickerModels = useMemo(() => models.data?.models ?? [], [models.data]);
  // A model that left the list (switched off by the owner) falls back to Auto.
  useEffect(() => {
    if (models.data && prefs.model !== 'auto' && !pickerModels.some((m) => m.id === prefs.model)) prefs.set({ model: 'auto' });
  }, [models.data, pickerModels, prefs]);

  // Open the conversation in the address, unless it is already the one on screen.
  const needLoad = !!id && id !== conversationId;
  const conv = useQuery({ queryKey: ['vinaxai', 'conversation', id], queryFn: () => getConversation(id!), enabled: needLoad, staleTime: 0, gcTime: 0, retry: (n, e) => !(e instanceof AiError && e.status === 404) && n < 1 });
  useEffect(() => {
    if (needLoad && conv.data && conv.data.conversation.id === id) dispatch({ type: 'load', conversation: conv.data.conversation, messages: conv.data.messages });
  }, [needLoad, conv.data, id, dispatch]);

  // Opening another chat (or a new one) stops a reply still being written:
  // the server keeps what was written so far.
  const latest = useRef({ conversationId, streaming });
  latest.current = { conversationId, streaming };
  useEffect(() => {
    const cur = latest.current;
    if (cur.streaming && cur.conversationId && id !== cur.conversationId) stopReply();
    if (!id && cur.conversationId) resetChat();
  }, [id]);

  // A new conversation gets its own address once the server names it.
  useEffect(() => {
    if (conversationId && !id) navigate(`/vinaxai/c/${conversationId}`, { replace: true });
  }, [conversationId, id, navigate]);

  const [draft, setDraft] = useState('');
  const composer = useRef<ComposerHandle>(null);
  const stick = useRef(true);
  const send = async () => {
    const text = draft;
    setDraft('');
    haptic('light');
    stick.current = true;
    const out = await sendMessage(text);
    if (!out.ok && out.beforeStart) setDraft((d) => d || text);
  };
  const edit = (parentId: string | null) => (text: string) => {
    stick.current = true;
    void sendMessage(text, { parentId });
  };

  // Follow new output unless the listener scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
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

  // The sidebar: a column on wide screens (collapsible), a drawer otherwise.
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useDismiss(drawer && !wide, () => setDrawer(false), [drawerRef]);
  useEffect(() => {
    if (!drawer || wide) return;
    const back = menuButton.current;
    drawerRef.current?.querySelector<HTMLElement>('button, a, input')?.focus();
    return () => back?.focus();
  }, [drawer, wide]);
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || wide) return;
    const f = [...(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input') ?? [])];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const sideOpen = wide ? !prefs.sidebarCollapsed : drawer;

  const root = useRef<HTMLDivElement>(null);
  useKeyboardInset(root);

  const newChat = () => {
    resetChat();
    setDraft('');
    setDrawer(false);
    navigate('/vinaxai');
    composer.current?.focus();
  };

  const composerEl = (
    <Composer
      ref={composer}
      value={draft}
      onChange={setDraft}
      onSend={() => void send()}
      onStop={stopReply}
      streaming={streaming}
      models={pickerModels}
      model={prefs.model}
      onModel={(m) => prefs.set({ model: m })}
      thinking={prefs.extendedThinking}
      onThinking={(v) => prefs.set({ extendedThinking: v })}
      search={models.data?.search ? { value: prefs.webSearch, onChange: (v) => prefs.set({ webSearch: v }) } : undefined}
    />
  );
  const noticeEl = notice && (
    <div className="vx-ai-notice" role="alert">
      <span>{notice.message}</span>
      <button type="button" onClick={() => dispatch({ type: 'dismiss' })} aria-label="Dismiss">×</button>
    </div>
  );
  const footer = <p className="vx-ai-footer">VinaX AI can make mistakes. Messages are sent to AI providers to generate replies.</p>;

  let body: ReactNode;
  const empty = thread.length === 0;
  if (models.isPending) body = <div className="vx-ai-loading" aria-busy="true" />;
  else if (models.isError || !models.data?.configured) body = <Calm title="VinaX AI is unavailable right now" body="Please try again in a little while." action={<button type="button" className="vx-ai-chip" onClick={() => void models.refetch()}>Try again</button>} />;
  else if (!models.data.enabled) body = <Calm title="VinaX AI is taking a break" body="It will be back soon. Your music keeps playing in the meantime." />;
  else if (needLoad && conv.isError) body = <Calm title="This chat isn’t available" body="It may have been deleted, or it belongs to another account." action={<button type="button" className="vx-ai-chip" onClick={newChat}>New chat</button>} />;
  else if (needLoad) body = <div className="vx-ai-loading" aria-busy="true" />;
  else if (empty) {
    body = (
      <div className="vx-ai-scroll">
        <div className="vx-ai-column vx-ai-welcome">
          <div className="vx-ai-empty">
            <SparkIcon className="w-8 h-8" />
            <h2>{greeting(new Date().getHours(), firstName)}</h2>
          </div>
          {noticeEl}
          {composerEl}
          <div className="vx-ai-starters" role="group" aria-label="Start with">
            {STARTERS.map((s) => (
              <button key={s.label} type="button" className="vx-ai-chip" onClick={() => { setDraft(s.text); requestAnimationFrame(() => composer.current?.focus()); }}>
                {s.label}
              </button>
            ))}
          </div>
          {footer}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <div className="vx-ai-scroll" ref={scroller} onScroll={onScroll}>
          <div className="vx-ai-column">
            <section className="vx-ai-thread" aria-label="Conversation">
              {thread.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} message={m} onEdit={conversationId ? edit(m.parentId) : undefined} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    live={streaming && m.id === replyId}
                    models={pickerModels}
                    onRetry={m.parentId && conversationId ? (choice) => void retryReply(m.parentId!, choice) : undefined}
                    onContinue={conversationId && !m.local ? () => void continueReply(m.id) : undefined}
                  />
                ),
              )}
            </section>
          </div>
        </div>
        {showJump && (
          <button type="button" className="vx-ai-jump" onClick={jump} aria-label="Jump to the latest message">
            <ArrowDownIcon className="w-4 h-4" />
          </button>
        )}
        <div className="vx-ai-dock">
          <div className="vx-ai-column">
            {noticeEl}
            {composerEl}
            {footer}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`vx-ai${sideOpen && wide ? ' has-side' : ''}`} ref={root}>
      {sideOpen && (
        <>
          {!wide && <div className="vx-ai-scrim vx-ai-drawer-scrim" aria-hidden onClick={() => setDrawer(false)} />}
          <div
            ref={drawerRef}
            className={wide ? 'vx-ai-side' : 'vx-ai-side is-drawer'}
            {...(wide ? {} : { role: 'dialog', 'aria-modal': true, 'aria-label': 'Chats' })}
            onKeyDown={trapTab}
          >
            <Sidebar drawer={!wide} onNavigate={() => setDrawer(false)} onNewChat={newChat} onCollapse={wide ? () => prefs.set({ sidebarCollapsed: true }) : () => setDrawer(false)} />
          </div>
        </>
      )}
      <div className="vx-ai-pane">
        <header className="vx-ai-header">
          {!(wide && sideOpen) && (
            <button
              ref={menuButton}
              type="button"
              className="vx-ai-icon-btn"
              onClick={() => (wide ? prefs.set({ sidebarCollapsed: false }) : setDrawer(true))}
              aria-label={wide ? 'Open sidebar' : 'Open chats'}
              aria-expanded={wide ? undefined : drawer}
            >
              {wide ? <SidebarIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
            </button>
          )}
          <div className="vx-ai-brand">
            <h1 className={`vx-ai-wordmark${wide && sideOpen ? ' sr-only' : ''}`}>VinaX AI</h1>
            {title && <span className="vx-ai-title" title={title}>{title}</span>}
          </div>
          <div className="vx-ai-header-end">
            <NowPlayingPill />
            {!(wide && sideOpen) && (
              <button type="button" className="vx-ai-icon-btn" onClick={newChat} aria-label="New chat" title="New chat">
                <NewChatIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>
        <div className={`vx-ai-main${empty ? ' is-empty' : ''}`}>{body}</div>
      </div>
      <div className="sr-only" aria-live="polite">{announce}</div>
    </div>
  );
}
