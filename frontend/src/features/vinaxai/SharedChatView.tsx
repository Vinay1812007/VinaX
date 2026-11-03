/**
 * VinaX AI — a shared chat at /vinaxai/share/:shareId. Read-only and open to
 * anyone with the link, signed in or not: the title, when it was shared,
 * and the turns rendered like the chat (Markdown, code, maths, artifacts in
 * the same panel). No composer. A signed-in reader can continue it in a new
 * chat of their own; anyone else is offered a chat of their own.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from '@/components/useAccount';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/store/toastStore';
import { AiError, continueSharedChat, getSharedChat, noticeFor, shareUrl } from './api';
import { ArtifactCard, ArtifactPanel } from './ArtifactPanel';
import { usePanel } from './artifactStore';
import { collectVersions, hasPreview, parseArtifacts, type Artifact } from './artifacts';
import { copyText } from './CodeBlock';
import { Markdown } from './Markdown';
import { SourcesRow } from './Sources';
import { PaneSkeleton } from './Skeleton';
import { shareDate, ShareActions } from './ShareDialog';
import { CopyIcon, FileIcon, SparkIcon } from './icons';
import { resetChat } from './store';
import type { ChatMessage, SharedChat } from './types';

const KIND: Record<string, string> = { image: 'Image', pdf: 'PDF', text: 'Text' };

/** The snapshot as chat messages, so artifacts and their versions work as in the chat. */
export function sharedThread(share: SharedChat): ChatMessage[] {
  return share.messages.map((m, i) => ({
    id: `shared-${i}`,
    parentId: i ? `shared-${i - 1}` : null,
    role: m.role,
    text: m.text,
    thinking: '',
    thinkingMs: null,
    model: null,
    stopReason: null,
    error: null,
    sources: m.sources && Array.isArray(m.sources.items) ? m.sources : null,
    createdAt: m.createdAt,
  }));
}

function SharedFiles({ files }: { files: Array<{ name: string; kind: string }> }): ReactNode {
  return (
    <ul className="vx-ai-files" aria-label="Files (not included)">
      {files.map((f, i) => (
        <li key={i}>
          <span className="vx-ai-file">
            <FileIcon className="w-5 h-5" />
            <span className="vx-ai-file-text">
              <span className="vx-ai-file-name">{f.name}</span>
              <span className="vx-ai-file-meta">{KIND[f.kind] ?? 'File'} · not included</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Reply({ message, versionOf, onOpen }: { message: ChatMessage; versionOf(id: string, messageId: string): number; onOpen(a: Artifact, messageId: string): void }): ReactNode {
  const { text } = message;
  return (
    <div className="vx-ai-turn vx-ai-turn-reply">
      <h2 className="sr-only">VinaX AI said</h2>
      {text.includes('<artifact')
        ? parseArtifacts(text).map((seg, i) => (seg.kind === 'text'
          ? <Markdown key={i} text={seg.text} sources={message.sources?.items} />
          : <ArtifactCard key={i} artifact={seg.artifact} live={false} version={versionOf(seg.artifact.id, message.id)} onOpen={() => onOpen(seg.artifact, message.id)} />))
        : <Markdown text={text} sources={message.sources?.items} />}
      {message.sources && <SourcesRow sources={message.sources} />}
      <div className="vx-ai-actions">
        <button type="button" className="vx-ai-act" onClick={() => void copyText(text)} aria-label="Copy reply" title="Copy">
          <CopyIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function SharedChatView(): ReactNode {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const account = useAccount();
  const wide = useMediaQuery('(min-width: 1024px)');
  const q = useQuery({
    queryKey: ['vinaxai', 'shared', shareId],
    queryFn: () => getSharedChat(shareId),
    retry: (n, e) => !(e instanceof AiError && e.status === 404) && n < 1,
    staleTime: 60_000,
  });
  const share = q.data?.share ?? null;
  usePageTitle(share ? `${share.title} · Shared VinaX AI chat` : 'Shared VinaX AI chat');

  const thread = useMemo(() => (share ? sharedThread(share) : []), [share]);
  const files = useMemo(() => share?.messages.map((m) => m.files ?? []) ?? [], [share]);
  const versions = useMemo(() => collectVersions(thread), [thread]);
  const panel = usePanel();
  useEffect(() => { usePanel.getState().close(); return () => usePanel.getState().close(); }, [shareId]);
  const versionOf = (id: string, messageId: string) => (versions.get(id)?.findIndex((v) => v.messageId === messageId) ?? 0) + 1;
  const openArtifact = (a: Artifact, messageId: string) => panel.show(a.id, Math.max(0, versionOf(a.id, messageId) - 1), { tab: hasPreview(a.type) ? 'preview' : 'code' });

  const [continuing, setContinuing] = useState(false);
  const continueChat = async () => {
    setContinuing(true);
    try {
      const r = await continueSharedChat(shareId);
      void qc.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] });
      resetChat();
      navigate(`/vinaxai/c/${r.conversationId}`);
    } catch (e) {
      toast(e instanceof AiError && e.code === 'not_found' ? 'This shared chat isn’t available any more.' : noticeFor(e instanceof AiError ? e.code : 'network'));
      setContinuing(false);
    }
  };

  const next = account ? (
    <button type="button" className="vx-ai-chip is-primary" onClick={() => void continueChat()} disabled={continuing}>
      <SparkIcon className="w-4 h-4" /> {continuing ? 'Opening…' : 'Continue this chat'}
    </button>
  ) : (
    <Link to="/vinaxai" className="vx-ai-chip is-primary">
      <SparkIcon className="w-4 h-4" /> Start your own chat
    </Link>
  );

  let body: ReactNode;
  if (q.isPending) body = <PaneSkeleton kind="chat" label="Loading the shared chat" />;
  else if (!share) {
    const gone = q.error instanceof AiError && q.error.status === 404;
    body = (
      <div className="vx-ai-calm" role="status">
        <SparkIcon className="w-8 h-8" />
        <h1>{gone ? 'This shared chat isn’t available' : 'Couldn’t open this shared chat'}</h1>
        <p>{gone ? 'The link may be wrong, or the person who shared it stopped sharing.' : 'Check your connection, then try again.'}</p>
        {gone ? next : <button type="button" className="vx-ai-chip" onClick={() => void q.refetch()}>Try again</button>}
      </div>
    );
  } else {
    const report = `mailto:hello@vinaxmusic.online?subject=${encodeURIComponent('Report a shared VinaX AI chat')}&body=${encodeURIComponent(`Link: ${shareUrl(share.id)}\n\nWhat's wrong:\n`)}`;
    body = (
      <div className="vx-ai-scroll">
        <div className="vx-ai-column">
          <div className="vx-ai-share-intro">
            <p className="vx-ai-share-kicker">Shared VinaX AI chat</p>
            <h1>{share.title}</h1>
            <p className="vx-ai-opt-sub">
              Shared <time dateTime={share.updatedAt}>{shareDate(share.updatedAt)}</time> · Later messages in the original chat aren’t shown
            </p>
          </div>
          <section className="vx-ai-thread" aria-label="Shared conversation">
            {thread.map((m, i) => (m.role === 'user' ? (
              <div key={m.id} className="vx-ai-turn vx-ai-turn-user">
                <h2 className="sr-only">Message</h2>
                {files[i]?.length ? <SharedFiles files={files[i]} /> : null}
                {m.text && <div className="vx-ai-bubble">{m.text}</div>}
              </div>
            ) : (
              <Reply key={m.id} message={m} versionOf={versionOf} onOpen={openArtifact} />
            )))}
          </section>
          <div className="vx-ai-share-end">
            <p>This is a copy of a chat someone shared. VinaX AI can make mistakes, so check anything important.</p>
            <div className="vx-ai-share-row">
              {next}
              <ShareActions link={shareUrl(share.id)} title={share.title} />
            </div>
            <a className="vx-ai-share-report" href={report}>Report this chat</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vx-ai vx-ai-shared">
      <div className="vx-ai-pane">
        <header className="vx-ai-header">
          <div className="vx-ai-brand">
            <Link to="/vinaxai" className="vx-ai-wordmark">VinaX AI</Link>
            {share && <span className="vx-ai-title" title={share.title}>{share.title}</span>}
          </div>
          <div className="vx-ai-header-end">{share && next}</div>
        </header>
        <div className="vx-ai-main">{body}</div>
      </div>
      {panel.open && <ArtifactPanel versions={versions.get(panel.open.id) ?? []} live={false} sheet={!wide} />}
    </div>
  );
}
