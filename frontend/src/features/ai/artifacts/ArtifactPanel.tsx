import { useEffect, useMemo, useRef, useState } from 'react';
import { RichContent } from '@/components/ai/RichContent';
import { newToken, openPreview, postPreview } from '@/components/ai/preview';
import { downloadFile } from '../chat/storage';
import { collectArtifacts, fileNameFor, isPreviewable, type Artifact } from './collect';
import type { Msg } from '../chat/types';

/**
 * 9.1.0 — the artifact panel: the documents, pages and code a conversation
 * produced, on their own, with every version kept.
 *
 * Why it exists: a reply that writes a file is the thing the listener came for,
 * and scrolling back through a long chat to find the newest version of it — or an
 * older one they preferred — was the only way to get at it. The panel lists each
 * artifact once, with a version switcher, and offers Copy, Download and (for a
 * page or a drawing) a live preview.
 *
 * The preview reuses the sandbox that already exists for "Run"
 * (`components/ai/preview.ts` → `/api/preview`): the page is POSTed to the
 * endpoint and rendered in an iframe whose effective sandbox is the intersection
 * of the `sandbox` attribute here and the `sandbox` CSP directive the endpoint
 * sends. Neither grants `allow-same-origin`, so the preview runs on an **opaque
 * origin**: it cannot read the app's cookies, its localStorage or any privileged
 * API, and camera/microphone/geolocation are deliberately not delegated.
 *
 * Nothing is extracted that the chat does not already show, and nothing is
 * invented: an artifact is exactly a closed fenced block from an assistant reply
 * (`./collect.ts`).
 */

const KIND_LABEL: Record<Artifact['kind'], string> = { page: 'Page', diagram: 'Diagram', document: 'Document', code: 'Code' };

/** The sandbox attribute must stay in step with the endpoint's CSP sandbox. */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';

function PagePreview({ html, title }: { html: string; title: string }) {
  const [token] = useState(newToken);
  const frameName = `vxart${token}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    // The frame has to exist before the form targets it by name.
    if (frameRef.current) postPreview(html, token, frameName, title);
  }, [html, token, frameName, title]);
  return (
    <>
      <iframe
        ref={frameRef}
        title={`Preview of ${title}`}
        name={frameName}
        sandbox={SANDBOX}
        allow="fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        className="w-full flex-1 min-h-[16rem] bg-white rounded-lg"
      />
      <div className="flex items-center gap-3 px-1 pt-2 text-[11px] ai-t3">
        <button
          type="button"
          className="underline hover:ai-t1"
          onClick={() => {
            if (!openPreview(html, token, title)) setBlocked(true);
          }}
        >
          Open in a new tab
        </button>
        {blocked && <span className="text-[color:var(--vx-danger)]">Your browser blocked the new tab.</span>}
        <span>Runs isolated — it cannot reach anything in VinaX.</span>
      </div>
    </>
  );
}

export function ArtifactPanel({ messages, onClose, onJump }: { messages: readonly Msg[]; onClose: () => void; onJump?: (messageIndex: number) => void }) {
  const artifacts = useMemo(() => collectArtifacts(messages), [messages]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [versionAt, setVersionAt] = useState<number | null>(null);
  const [tab, setTab] = useState<'source' | 'preview'>('source');

  // Follow the newest artifact as the conversation grows, unless the listener
  // has opened one themselves.
  const selected = artifacts.find((a) => a.id === openId) ?? artifacts[artifacts.length - 1];
  const versionIndex = versionAt ?? (selected ? selected.versions.length - 1 : 0);
  const version = selected?.versions[Math.min(versionIndex, selected.versions.length - 1)];

  if (!artifacts.length) {
    return (
      <aside className="ai-artifacts" aria-label="Artifacts">
        <header className="ai-artifacts-head">
          <h2 className="ai-artifacts-title">Artifacts</h2>
          <button type="button" onClick={onClose} className="ai-icon-btn" aria-label="Close artifacts">×</button>
        </header>
        <p className="ai-artifacts-empty">
          Nothing yet. Documents, pages and code from the replies in this chat collect here, with every version kept.
        </p>
      </aside>
    );
  }

  return (
    <aside className="ai-artifacts" aria-label="Artifacts">
      <header className="ai-artifacts-head">
        <h2 className="ai-artifacts-title">
          Artifacts <span className="ai-t3">· {artifacts.length}</span>
        </h2>
        <button type="button" onClick={onClose} className="ai-icon-btn" aria-label="Close artifacts">×</button>
      </header>

      <ul className="ai-artifacts-list" aria-label="Artifacts in this chat">
        {artifacts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={a.id === selected?.id ? 'ai-artifacts-item is-on' : 'ai-artifacts-item'}
              aria-current={a.id === selected?.id ? 'true' : undefined}
              onClick={() => {
                setOpenId(a.id);
                setVersionAt(null);
                setTab(isPreviewable(a) ? 'preview' : 'source');
              }}
            >
              <span className="ai-artifacts-item-name">{a.title}</span>
              <span className="ai-t3">
                {KIND_LABEL[a.kind]}
                {a.versions.length > 1 && ` · ${a.versions.length} versions`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && version && (
        <div className="ai-artifacts-body">
          <div className="ai-artifacts-bar">
            {selected.versions.length > 1 && (
              <label className="ai-artifacts-ver">
                <span className="sr-only">Version of {selected.title}</span>
                <select
                  value={versionIndex}
                  onChange={(e) => setVersionAt(Number(e.target.value))}
                  aria-label={`Version of ${selected.title}`}
                >
                  {selected.versions.map((v, i) => (
                    <option key={i} value={i}>
                      {i === selected.versions.length - 1 ? `v${i + 1} (current)` : `v${i + 1}`} · {v.lines} lines
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isPreviewable(selected) && (
              <div className="ai-artifacts-tabs" role="tablist" aria-label="View">
                {(['preview', 'source'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? 'ai-artifacts-tab is-on' : 'ai-artifacts-tab'}
                    onClick={() => setTab(t)}
                  >
                    {t === 'preview' ? 'Preview' : 'Source'}
                  </button>
                ))}
              </div>
            )}
            <div className="ai-artifacts-acts">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(version.code)} className="ai-artifacts-act">
                Copy
              </button>
              <button
                type="button"
                onClick={() => downloadFile(fileNameFor(selected), version.code, 'text/plain;charset=utf-8')}
                className="ai-artifacts-act"
              >
                Download
              </button>
              {onJump && (
                <button type="button" onClick={() => onJump(version.messageIndex)} className="ai-artifacts-act">
                  Show in chat
                </button>
              )}
            </div>
          </div>

          {isPreviewable(selected) && tab === 'preview' ? (
            <PagePreview key={`${selected.id}:${versionIndex}`} html={version.code} title={selected.title} />
          ) : (
            <div className="ai-artifacts-source">
              {/* The same renderer the chat uses, so highlighting, diagrams and
                  maths look identical here. */}
              <RichContent text={`\`\`\`${selected.lang}\n${version.code}\n\`\`\``} />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
