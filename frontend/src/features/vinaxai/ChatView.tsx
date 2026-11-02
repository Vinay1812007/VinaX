/**
 * VinaX AI — the chat at /vinaxai and /vinaxai/c/:id.
 *
 *   wide (≥1024px):  [ sidebar 260px, collapsible ] [ header · thread · composer ]
 *   narrow:          [ header ☰ · thread · composer ]  + the sidebar as a drawer
 *
 * A new chat opens on a greeting with the composer in the middle and four
 * suggestion chips that fill in a starter (they never send). Signed-out
 * visitors never get here: the app's sign-in gate answers first.
 * /vinaxai/projects and /vinaxai/project/:projectId show the projects in the
 * same frame (Projects.tsx, lazy); a project's page uses this composer to
 * start a chat in the project. See docs/ai.md.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { haptic } from '@/services/native';
import { AiError, getConversation, getModels, listProjects, PROJECTS_KEY } from './api';
import { pathTo } from './chatState';
import { Composer, type ComposerHandle } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { NowPlayingPill } from './NowPlayingPill';
import { usePrefs } from './prefs';
import { Sidebar } from './Sidebar';
import { continueReply, resetChat, retryReply, selectBranch, sendMessage, stopReply, useChatStore } from './store';
import { useDismiss } from './useDismiss';
import { usePendingFiles } from './usePendingFiles';
import { PendingChips } from './FileChips';
import type { FileRef } from './types';
import { ArtifactPanel } from './ArtifactPanel';
import { usePanel } from './artifactStore';
import { artifactsOf, collectVersions, hasPreview, type Artifact } from './artifacts';
import { ArrowDownIcon, FolderIcon, MenuIcon, NewChatIcon, SettingsIcon, ShareIcon, SidebarIcon, SparkIcon } from './icons';
import { useVoiceDictation } from './useVoiceDictation';
import { dismissReadNotice, stopReading, useReadAloud } from './readAloud';
import { SettingsPanel, type SettingsSection } from './SettingsPanel';
import { ShareDialog } from './ShareDialog';

/** Live voice loads only when someone opens it. */
const LiveView = lazy(() => import('./live/LiveView'));
/** Projects load only when a project page opens. */
const ProjectsArea = lazy(() => import('./Projects'));

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
  const { id, projectId: projectPage } = useParams();
  const { pathname } = useLocation();
  // Which page: a chat, the projects list or one project.
  const view: 'chat' | 'projects' | 'project' = projectPage ? 'project' : pathname.startsWith('/vinaxai/projects') ? 'projects' : 'chat';
  const navigate = useNavigate();
  const account = useAccount();
  const firstName = account?.user.name?.trim().split(/\s+/)[0] ?? null;
  const wide = useMediaQuery('(min-width: 1024px)');
  const prefs = usePrefs();

  const conversationId = useChatStore((s) => s.conversationId);
  const title = useChatStore((s) => s.title);
  const chatProject = useChatStore((s) => s.projectId);
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

  usePageTitle(view === 'chat' ? title ?? 'VinaX AI' : 'Projects');
  // The project a chat is in, named in the header with a link back to it.
  const projects = useQuery({ queryKey: PROJECTS_KEY, queryFn: listProjects, staleTime: 60_000, enabled: view === 'chat' && !!chatProject });
  const inProject = view === 'chat' && chatProject ? projects.data?.items.find((p) => p.id === chatProject) ?? null : null;

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

  // A new conversation gets its own address once the server names it (read
  // fresh: leaving a chat for the projects pages has just reset it).
  useEffect(() => {
    const current = useChatStore.getState().conversationId;
    if (current && !id && current === conversationId) navigate(`/vinaxai/c/${current}`, { replace: view === 'chat' });
  }, [conversationId, id, navigate, view]);

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
  const [sharing, setSharing] = useState(false);
  // Share is offered for a saved chat with messages.
  const canShare = !!conversationId && thread.some((m) => !m.local);
  useEffect(() => { setSharing(false); }, [conversationId]);
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
    const out = await sendMessage(text, { files, ...(view === 'project' && projectPage ? { projectId: projectPage } : {}) });
    if (!out.ok && out.beforeStart) {
      setDraft((d) => d || text);
      tray.restore(files);
    }
  };
  // "Fix it" on a failed preview: ask for a corrected artifact, with the error the preview gave.
  const fixArtifact = (a: Artifact, error: string) => {
    if (useChatStore.getState().streaming) return;
    stick.current = true;
    const what = a.type === 'mermaid' ? 'diagram' : a.type === 'svg' ? 'picture' : a.type === 'react' ? 'component' : 'page';
    void sendMessage(`The ${what} "${a.title || 'artifact'}" didn't work. The preview said:\n\n${error.slice(0, 600)}\n\nPlease fix it and send the complete corrected artifact.`);
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

  // Opened from the artifacts gallery (?m=<reply>&a=<artifact>): show that
  // reply's branch, scroll to it and open its artifact, once.
  const [params, setParams] = useSearchParams();
  const jumpTo = params.get('m');
  const jumpArtifact = params.get('a');
  useEffect(() => {
    if (!jumpTo || !id || conversationId !== id || streaming) return;
    if (!messages[jumpTo]) { setParams({}, { replace: true }); return; }
    if (!thread.some((m) => m.id === jumpTo)) { selectBranch(jumpTo); return; }
    setParams({}, { replace: true });
    stick.current = false;
    const v = jumpArtifact ? versions.get(jumpArtifact) : undefined;
    const at = v?.findIndex((x) => x.messageId === jumpTo) ?? -1;
    if (v && at >= 0) usePanel.getState().show(jumpArtifact!, at, { tab: hasPreview(v[at].artifact.type) ? 'preview' : 'code' });
    requestAnimationFrame(() => [...(scroller.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find((el) => el.dataset.messageId === jumpTo)?.scrollIntoView({ block: 'start' }));
  }, [jumpTo, jumpArtifact, id, conversationId, streaming, messages, thread, versions, setParams]);

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
      onLive={voice?.live && view === 'chat' ? openLive : undefined}
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
  else if (view !== 'chat') {
    body = (
      <Suspense fallback={<div className="vx-ai-loading" aria-busy="true" />}>
        <ProjectsArea
          projectId={view === 'project' ? projectPage ?? null : null}
          composer={<>{noticeEl}{voiceNoticeEl}{fileNotice}{visionChip}{composerEl}</>}
        />
      </Suspense>
    );
  } else if (needLoad && conv.isError) body = <Calm title="This chat isn’t available" body="It may have been deleted, or it belongs to another account." action={<button type="button" className="vx-ai-chip" onClick={newChat}>New chat</button>} />;
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
                    onFixArtifact={conversationId && !streaming ? fixArtifact : undefined}
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
            <Sidebar drawer={!wide} onNavigate={() => setDrawer(false)} onSettings={() => { setDrawer(false); setSettings('general'); }} onNewChat={newChat} onCollapse={wide ? () => prefs.set({ sidebarCollapsed: true }) : () => setDrawer(false)} />
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
            {inProject && (
              <Link to={`/vinaxai/project/${inProject.id}`} className="vx-ai-proj-chip" title={`Project: ${inProject.name}`}>
                <FolderIcon className="w-3.5 h-3.5" />
                <span><span className="sr-only">Project: </span>{inProject.name}</span>
              </Link>
            )}
            {view !== 'chat' ? <span className="vx-ai-title">Projects</span> : title && <span className="vx-ai-title" title={title}>{title}</span>}
          </div>
          <div className="vx-ai-header-end">
            <NowPlayingPill />
            {canShare && (
              <button type="button" className="vx-ai-icon-btn" onClick={() => setSharing(true)} disabled={streaming} aria-label="Share chat" title="Share chat" aria-haspopup="dialog">
                <ShareIcon className="w-5 h-5" />
              </button>
            )}
            <button type="button" className="vx-ai-icon-btn" onClick={() => setSettings('general')} aria-label="VinaX AI settings" title="Settings">
              <SettingsIcon className="w-5 h-5" />
            </button>
            {!(wide && sideOpen) && (
              <button type="button" className="vx-ai-icon-btn" onClick={newChat} aria-label="New chat" title="New chat">
                <NewChatIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>
        <div className={`vx-ai-main${empty && view === 'chat' ? ' is-empty' : ''}`}>{body}</div>
      </div>
      {panel.open && (
        <ArtifactPanel versions={versions.get(panel.open.id) ?? []} live={streaming} sheet={!wide} onFix={conversationId ? fixArtifact : undefined} />
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
      {sharing && conversationId && <ShareDialog conversationId={conversationId} title={title} onClose={() => setSharing(false)} />}
      {liveOpen && (
        <Suspense fallback={<div className="vx-ai-live" role="status" aria-label="Opening Live voice" />}>
          <LiveView conversationId={conversationId} parentMessageId={leafId} thinking={prefs.extendedThinking} voice={prefs.liveVoice} model={prefs.liveModel} micId={prefs.micId} searchAllowed={!!voice?.liveSearch} search={!!voice?.liveSearch && prefs.liveSearch} onClose={closeLive} />
        </Suspense>
      )}
    </div>
  );
}
