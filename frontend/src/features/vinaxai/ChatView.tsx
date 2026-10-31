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
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { usePendingFiles } from './usePendingFiles';
import { PendingChips } from './FileChips';
import type { FileRef } from './types';
import { ArtifactPanel } from './ArtifactPanel';
import { usePanel } from './artifactStore';
import { artifactsOf, collectVersions, hasPreview } from './artifacts';
import { ArrowDownIcon, MenuIcon, NewChatIcon, SettingsIcon, SidebarIcon, SparkIcon } from './icons';
import { useVoiceDictation } from './useVoiceDictation';
import { dismissReadNotice, stopReading, useReadAloud } from './readAloud';
import { SettingsPanel, type SettingsSection } from './SettingsPanel';

/** Live voice loads only when someone opens it. */
const LiveView = lazy(() => import('./live/LiveView'));

/** Markdown made readable aloud: code blocks named, not read; markup characters dropped. */
export function plainText(md: string): string {
  return md.replace(/<artifact[\s\S]*?(<\/artifact>|$)/g, ' (an artifact) ').replace(/```[\s\S]*?(```|$)/g, ' (code) ').replace(/[*_`#>|~]+/g, '').replace(/\[(\d+)\]/g, '').replace(/\s+/g, ' ').trim();
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
  const versions = useMemo(() => collectVersions(thread), [thread]);
  const panel = usePanel();
  const versionOf = (id: string, messageId: string) => (versions.get(id)?.findIndex((v) => v.messageId === messageId) ?? 0) + 1;
  const openArtifact = (a: { id: string; type: Parameters<typeof hasPreview>[0] }, messageId: string) =>
    panel.show(a.id, Math.max(0, versionOf(a.id, messageId) - 1), { tab: hasPreview(a.type) ? 'preview' : 'code' });

  // While a reply writes an artifact, the panel opens on it and fills live
  // (once per artifact: closing it is respected); when the reply is done it
  // turns to Preview.
  const autoOpened = useRef(new Set<string>());
  const liveReply = streaming && replyId ? messages[replyId] : undefined;
  const liveArtifact = liveReply?.text.includes('<artifact') ? artifactsOf(liveReply.text).pop() : undefined;
  useEffect(() => {
    if (!liveArtifact || !replyId) return;
    const key = `${replyId}:${liveArtifact.id}`;
    if (autoOpened.current.has(key)) return;
    autoOpened.current.add(key);
    panel.show(liveArtifact.id, null, { tab: 'code', following: true });
  }, [liveArtifact?.id, replyId, panel, liveArtifact]);
  useEffect(() => {
    if (streaming || !panel.following || !panel.open) return;
    const latest = versions.get(panel.open.id)?.slice(-1)[0]?.artifact;
    if (latest && hasPreview(latest.type)) panel.setTab('preview');
    else usePanel.setState({ following: false });
  }, [streaming, panel, versions]);
  // Another chat closes the panel.
  useEffect(() => { usePanel.getState().close(); }, [conversationId]);

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
  const qc = useQueryClient();

  // Voice: dictation into the draft, Read aloud, Live voice and its settings.
  const voice = models.data?.voice;
  const dictation = useVoiceDictation((text) => {
    setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')} ${text}` : text));
    requestAnimationFrame(() => composer.current?.focus());
  });
  const readNotice = useReadAloud((s) => s.notice);
  const [liveOpen, setLiveOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  useEffect(() => () => stopReading(), []);
  useEffect(() => { stopReading(); }, [conversationId]);
  const openLive = () => {
    stopReading();
    if (streaming) stopReply();
    setLiveOpen(true);
  };
  const closeLive = (savedTo: string | null) => {
    setLiveOpen(false);
    if (!savedTo) return;
    void qc.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] });
    // Reload the chat so the spoken turns show in the thread (not from a cached copy of it).
    qc.removeQueries({ queryKey: ['vinaxai', 'conversation', savedTo] });
    resetChat();
    navigate(`/vinaxai/c/${savedTo}`, { replace: !!id && id === savedTo });
  };
  const stick = useRef(true);
  // Files in this chat so far, against the 20-per-chat limit.
  const filesInChat = useMemo(() => Object.values(messages).reduce((n, m) => n + (m.files?.length ?? 0), 0), [messages]);
  const tray = usePendingFiles(conversationId, filesInChat);
  const pickedModel = prefs.model === 'auto' ? null : pickerModels.find((m) => m.id === prefs.model) ?? null;
  const cannotSee = tray.hasImages && !!pickedModel && !pickedModel.flags.vision;
  const visionModel = pickerModels.find((m) => m.flags.vision && m.available);
  const send = async () => {
    const text = draft;
    const files = tray.take();
    setDraft('');
    haptic('light');
    stick.current = true;
    const out = await sendMessage(text, { files });
    if (!out.ok && out.beforeStart) {
      setDraft((d) => d || text);
      tray.restore(files);
    }
  };
  const edit = (parentId: string | null, files?: FileRef[]) => (text: string) => {
    stick.current = true;
    void sendMessage(text, { parentId, files });
  };
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragging(false);
    tray.add(e.dataTransfer.files);
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
    tray.clear();
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
      tray={<PendingChips files={tray.files} onRemove={tray.remove} />}
      onFiles={(fs) => tray.add(fs)}
      hasFiles={tray.files.some((f) => f.status === 'ready')}
      sendBlocked={tray.busy || cannotSee}
      dictation={voice?.dictation ? dictation : undefined}
      onLive={voice?.live ? openLive : undefined}
      onSettings={() => setSettings(voice && (voice.dictation || voice.readAloud || voice.live) ? 'voice' : 'chat')}
    />
  );
  const visionChip = cannotSee && (
    <div className="vx-ai-notice" role="alert">
      <span>{pickedModel!.name} can’t see images. Switch to a vision model or Auto?</span>
      <span className="vx-ai-notice-actions">
        {visionModel && <button type="button" className="vx-ai-chip" onClick={() => prefs.set({ model: visionModel.id })}>Use {visionModel.name}</button>}
        <button type="button" className="vx-ai-chip is-primary" onClick={() => prefs.set({ model: 'auto' })}>Use Auto</button>
      </span>
    </div>
  );
  const fileNotice = tray.notice && (
    <div className="vx-ai-notice" role="alert">
      <span>{tray.notice}</span>
      <button type="button" onClick={tray.dismissNotice} aria-label="Dismiss">×</button>
    </div>
  );
  const voiceNoticeText = dictation.notice ?? readNotice;
  const voiceNoticeEl = voiceNoticeText && (
    <div className="vx-ai-notice" role="alert">
      <span>{voiceNoticeText}</span>
      {dictation.notice && dictation.noticeIsMic && (
        <span className="vx-ai-notice-actions">
          <button type="button" className="vx-ai-chip" onClick={() => { dictation.dismiss(); setSettings('voice'); }}>Microphone settings</button>
        </span>
      )}
      <button type="button" onClick={() => { dictation.dismiss(); dismissReadNotice(); }} aria-label="Dismiss">×</button>
    </div>
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
          {voiceNoticeEl}
          {fileNotice}
          {visionChip}
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
                  <UserMessage key={m.id} message={m} onEdit={conversationId ? edit(m.parentId, m.files) : undefined} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    live={streaming && m.id === replyId}
                    models={pickerModels}
                    versionOf={versionOf}
                    onOpenArtifact={openArtifact}
                    onRetry={m.parentId && conversationId ? (choice) => void retryReply(m.parentId!, choice) : undefined}
                    onContinue={conversationId && !m.local ? () => void continueReply(m.id) : undefined}
                    canReadAloud={!!voice?.readAloud}
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
            {voiceNoticeEl}
            {fileNotice}
            {visionChip}
            {composerEl}
            {footer}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      className={`vx-ai${sideOpen && wide ? ' has-side' : ''}${dragging ? ' is-dragging' : ''}`}
      ref={root}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      {sideOpen && (
        <>
          {!wide && <div className="vx-ai-scrim vx-ai-drawer-scrim" aria-hidden onClick={() => setDrawer(false)} />}
          <div
            ref={drawerRef}
            className={wide ? 'vx-ai-side' : 'vx-ai-side is-drawer'}
            {...(wide ? {} : { role: 'dialog', 'aria-modal': true, 'aria-label': 'Chats' })}
            onKeyDown={trapTab}
          >
            <Sidebar drawer={!wide} onNavigate={() => setDrawer(false)} onSettings={() => { setDrawer(false); setSettings('chat'); }} onNewChat={newChat} onCollapse={wide ? () => prefs.set({ sidebarCollapsed: true }) : () => setDrawer(false)} />
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
            <button type="button" className="vx-ai-icon-btn" onClick={() => setSettings('chat')} aria-label="VinaX AI settings" title="Settings">
              <SettingsIcon className="w-5 h-5" />
            </button>
            {!(wide && sideOpen) && (
              <button type="button" className="vx-ai-icon-btn" onClick={newChat} aria-label="New chat" title="New chat">
                <NewChatIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>
        <div className={`vx-ai-main${empty ? ' is-empty' : ''}`}>{body}</div>
      </div>
      {panel.open && (
        <ArtifactPanel versions={versions.get(panel.open.id) ?? []} live={streaming} sheet={!wide} />
      )}
      <div className="sr-only" aria-live="polite">{announce}</div>
      {settings && (
        <SettingsPanel
          models={pickerModels}
          groups={models.data?.groups ?? []}
          voice={voice}
          search={!!models.data?.search}
          section={settings}
          onClose={() => setSettings(null)}
        />
      )}
      {liveOpen && (
        <Suspense fallback={<div className="vx-ai-live" role="status" aria-label="Opening Live voice" />}>
          <LiveView conversationId={conversationId} parentMessageId={leafId} thinking={prefs.extendedThinking} voice={prefs.liveVoice} model={prefs.liveModel} micId={prefs.micId} onClose={closeLive} />
        </Suspense>
      )}
    </div>
  );
}
