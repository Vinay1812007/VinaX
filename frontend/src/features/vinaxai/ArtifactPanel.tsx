/**
 * VinaX AI — the artifacts panel: the artifact's title, its versions
 * ("v2 of 3"), Preview / Code, Copy, Download and Close. On a wide screen it
 * sits beside the chat and can be resized (40–60%); otherwise it is a
 * full-screen sheet.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { CodeBlock, copyText } from './CodeBlock';
import { Markdown } from './Markdown';
import { openInNewTab, RunnerFrame } from './RunnerFrame';
import { codeLanguage, downloadName, hasPreview, runsInSandbox, type Artifact } from './artifacts';
import { usePanel } from './artifactStore';
import { ChevronIcon, CloseIcon, CodeIcon, ComponentIcon, CopyIcon, DiagramIcon, DownloadIcon, FileIcon, ImageIcon, OpenExternalIcon, PageIcon } from './icons';

const TYPE_LABEL: Record<Artifact['type'], string> = { code: 'Code', html: 'HTML', svg: 'SVG', mermaid: 'Diagram', markdown: 'Document', react: 'React' };
export const TYPE_ICON: Record<Artifact['type'], (p: { className?: string }) => ReactNode> = { code: CodeIcon, html: PageIcon, svg: ImageIcon, mermaid: DiagramIcon, markdown: FileIcon, react: ComponentIcon };

export function download(a: Artifact): void {
  const { name, mime } = downloadName(a);
  const url = URL.createObjectURL(new Blob([a.content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

interface Props {
  versions: Array<{ messageId: string; artifact: Artifact }>;
  live: boolean;
  sheet: boolean;
  /** A failed preview offers "Fix it" (the chat only; never on a shared page). */
  onFix?(artifact: Artifact, error: string): void;
  /** The gallery: the chat it came from, under the kind. */
  from?: string | null;
  /** The gallery: open the chat at the reply that made the shown version. */
  onOpenChat?(messageId: string): void;
}

export function ArtifactPanel({ versions, live, sheet, onFix, from, onOpenChat }: Props): ReactNode {
  const { open, tab, width, setTab, setVersion, setWidth, close } = usePanel();
  useDismissOnBack(sheet && !!open, close);
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  /** While it is written, the code follows its newest line, unless the listener scrolled up to read. */
  const follow = useRef(true);
  useEffect(() => { if (sheet) root.current?.querySelector<HTMLElement>('button')?.focus(); }, [sheet]);
  const current = open && versions.length ? versions[open.version == null ? versions.length - 1 : Math.min(open.version, versions.length - 1)] : null;
  const isWriting = !!current && live && current === versions[versions.length - 1] && current.artifact.incomplete;
  const content = current?.artifact.content;
  useEffect(() => {
    // Code view scrolls inside the code box; anything else scrolls the body.
    const el = body.current?.querySelector<HTMLElement>('.vx-ai-code-body') ?? body.current;
    if (el && isWriting && follow.current) el.scrollTop = el.scrollHeight;
  }, [content, isWriting]);
  useEffect(() => { if (!isWriting) follow.current = true; }, [isWriting]);
  if (!open || !versions.length) return null;
  const index = open.version == null ? versions.length - 1 : Math.min(open.version, versions.length - 1);
  const a = versions[index].artifact;
  const writing = live && index === versions.length - 1 && a.incomplete;
  const previewable = hasPreview(a.type);
  const showing = previewable && tab === 'preview' && !writing ? 'preview' : 'code';

  // Resize from the left edge: pointer drag or arrow keys.
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const host = root.current?.parentElement;
    if (!host) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = host.getBoundingClientRect();
    const move = (ev: globalThis.PointerEvent) => setWidth(((box.right - ev.clientX) / box.width) * 100);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const keyResize = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width + 2); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width - 2); }
  };

  return (
    <>
      {!sheet && (
        <div
          className="vx-ai-artifact-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the artifact panel"
          aria-valuemin={40}
          aria-valuemax={60}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={drag}
          onKeyDown={keyResize}
        />
      )}
      <aside
        ref={root}
        className={`vx-ai-artifact${sheet ? ' is-sheet' : ''}`}
        style={sheet ? undefined : { flexBasis: `${width}%` }}
        aria-label={`Artifact: ${a.title}`}
        {...(sheet ? { role: 'dialog', 'aria-modal': true } : {})}
        onKeyDown={(e) => { if (e.key === 'Escape' && sheet) { e.stopPropagation(); close(); } }}
      >
        <header className="vx-ai-artifact-head">
          <div className="vx-ai-artifact-title">
            <h2>{a.title}</h2>
            <span className="vx-ai-opt-sub">{TYPE_LABEL[a.type]}{writing ? ' · writing…' : a.incomplete ? ' · incomplete' : ''}{from ? ` · ${from}` : ''}</span>
          </div>
          {versions.length > 1 && (
            <div className="vx-ai-branch" role="group" aria-label="Versions">
              <button type="button" className="vx-ai-act" aria-label="Previous version" disabled={index <= 0} onClick={() => setVersion(index - 1)}>
                <ChevronIcon className="w-4 h-4 rotate-180" />
              </button>
              <span className="vx-ai-branch-n">v{index + 1} of {versions.length}</span>
              <button type="button" className="vx-ai-act" aria-label="Next version" disabled={index >= versions.length - 1} onClick={() => setVersion(index + 1)}>
                <ChevronIcon className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="vx-ai-artifact-tools">
            {previewable && (
              <div className="vx-ai-tabs" role="tablist" aria-label="View">
                <button type="button" role="tab" aria-selected={showing === 'preview'} disabled={writing} onClick={() => setTab('preview')}>Preview</button>
                <button type="button" role="tab" aria-selected={showing === 'code'} onClick={() => setTab('code')}>Code</button>
              </div>
            )}
            {onOpenChat && (
              <button type="button" className="vx-ai-chip vx-ai-artifact-chat" onClick={() => onOpenChat(versions[index].messageId)}>
                Open chat
              </button>
            )}
            {runsInSandbox(a.type) && (
              <button type="button" className="vx-ai-act" onClick={() => openInNewTab(a.type, a.content, a.title)} aria-label="Open in new tab" title="Open in new tab" disabled={writing}>
                <OpenExternalIcon className="w-4 h-4" />
              </button>
            )}
            <button type="button" className="vx-ai-act" onClick={() => void copyText(a.content, 'Artifact copied')} aria-label="Copy artifact" title="Copy">
              <CopyIcon className="w-4 h-4" />
            </button>
            <button type="button" className="vx-ai-act" onClick={() => download(a)} aria-label="Download artifact" title="Download" disabled={writing}>
              <DownloadIcon className="w-4 h-4" />
            </button>
            <button type="button" className="vx-ai-act" onClick={close} aria-label="Close the artifact" title="Close">
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </header>
        {!live && a.incomplete && (
          <p className="vx-ai-artifact-cut" role="status">
            This was cut off before it finished, so the preview may not work. Press <strong>Continue</strong> under the reply to finish it.
          </p>
        )}
        <div
          ref={body}
          className="vx-ai-artifact-body"
          role={previewable ? 'tabpanel' : undefined}
          onScrollCapture={(e) => {
            if (!writing) return;
            const el = e.target as HTMLElement;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {showing === 'preview'
            ? runsInSandbox(a.type)
              ? <RunnerFrame kind={a.type} content={a.content} title={a.title} onFix={onFix && !live ? (error) => onFix(a, error) : undefined} />
              : <div className="vx-ai-artifact-doc"><Markdown text={a.content} /></div>
            : <CodeBlock code={a.content} lang={codeLanguage(a)} />}
        </div>
      </aside>
    </>
  );
}

/** The card in a message that opens an artifact. */
export function ArtifactCard({ artifact, version, live, onOpen }: { artifact: Artifact; version: number; live: boolean; onOpen(): void }): ReactNode {
  const writing = live && artifact.incomplete;
  return (
    // Its visible text is its name (title, kind, version), so speech and sight agree.
    <button type="button" className="vx-ai-artifact-card" onClick={onOpen}>
      <span className="vx-ai-artifact-icon" aria-hidden>{(() => { const Icon = TYPE_ICON[artifact.type]; return <Icon className="w-5 h-5" />; })()}</span>
      <span className="vx-ai-file-text">
        <span className="vx-ai-file-name">{writing ? <span className="vx-ai-shimmer">Creating {artifact.title || 'an artifact'}…</span> : artifact.title}</span>
        <span className="vx-ai-file-meta">
          {TYPE_LABEL[artifact.type]}{version > 1 ? ` · v${version}` : ''}{!live && artifact.incomplete ? ' · incomplete' : ''}{writing ? '' : ' · Open'}
        </span>
      </span>
    </button>
  );
}
