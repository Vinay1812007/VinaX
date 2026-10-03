import { memo, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChatPlayerCard } from '@/components/ChatPlayerCard';
import { GlobeIcon, SparkleIcon, WaveIcon } from '@/components/Icons';
import { RichContent } from '@/components/ai/RichContent';
import {
  BranchIcon,
  ContinueIcon,
  CopyIcon,
  ExpandIcon,
  FollowupChips,
  MoreMenu,
  PencilIcon,
  PinIcon,
  RefreshIcon,
  ShortenIcon,
  SimplifyIcon,
  SpeakerIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  type MoreAction,
} from '@/components/ai/AiExtras';
import { hideFollowupLine } from '@/features/ai/followups';
import { readAloud, readAloudSupported } from '@/features/ai/readAloud';
import { cn } from '@/utils/cn';
import { reducedMotion } from '@/utils/motion';
import { AgentActivity } from './AgentActivity';
import { CheckIcon } from './icons';
import type { Msg } from './types';

/** Everything a message can ask the page to do. The object is stable (see
 *  useStableHandlers), so memoised messages do not re-render with the page. */
export type MessageHandlers = {
  edit: (index: number, content: string) => void;
  rate: (index: number, rating: 'up' | 'down') => void;
  togglePin: (index: number) => void;
  branch: (index: number) => void;
  regenerate: () => void;
  continueReply: () => void;
  rewrite: (how: 'shorter' | 'longer' | 'simpler') => void;
  send: (text: string) => void;
};

const Images = ({ images }: { images?: string[] }): ReactNode => {
  // A stored chat keeps '' where a picture used to be — nothing to draw.
  const shown = (images ?? []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {shown.map((src, k) => (
        <img key={k} src={src} alt="attachment" className="ai-msg-img w-24 h-24 object-cover" />
      ))}
    </div>
  );
};

export const UserMessage = memo(function UserMessage({
  m,
  index,
  busy,
  handlers,
}: {
  m: Msg;
  index: number;
  busy: boolean;
  handlers: MessageHandlers;
}): ReactNode {
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-user ai-enter">
      <div className="ai-user-bubble" onDoubleClick={() => handlers.edit(index, m.content)} title="Double-tap to edit & resend">
        <Images images={m.images} />
        <p className="whitespace-pre-wrap">{m.content}</p>
      </div>
      {/* Beside the bubble, not under it: the thread keeps one rhythm. */}
      {!busy && (
        <div className="ai-toolbar">
          <button type="button" onClick={() => handlers.edit(index, m.content)} className="ai-tool" title="Edit and resend">
            <PencilIcon /> Edit
          </button>
        </div>
      )}
    </div>
  );
});

const WAITING = ['Thinking…', 'Reading your question…', 'Gathering ideas…', 'Putting it together…'];
const WAITING_AGENT = ['Working…', 'Planning the steps…', 'Looking things up…', 'Checking the details…'];

/** The pause before the first token: the VinaX mark breathing (it takes the
 *  Iris → Lagoon gradient while it waits) beside a short status in a Lagoon
 *  shimmer that changes every couple of seconds. The accessible name stays
 *  "Thinking" — a screen reader hears it once, not every rotation. */
function ThinkingMark({ agent }: { agent: boolean }): ReactNode {
  const lines = agent ? WAITING_AGENT : WAITING;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % lines.length), 2400);
    return () => window.clearInterval(t);
  }, [lines.length]);
  return (
    <span className="ai-thinking" role="status" aria-label="Thinking">
      <span key={i} className="ai-thinking-text ai-shimmer" aria-hidden>
        {lines[i]}
      </span>
    </span>
  );
}

function Sources({ sources, previews }: { sources: string[]; previews?: Array<{ url: string; title: string; snippet: string }> }): ReactNode {
  // 9.1.0 — when the server sent each source's own title and snippet, show them:
  // a reader can tell what a citation IS without opening it. The text comes from
  // an arbitrary page, so it is rendered as text (React escapes it) and never as
  // markup. Without previews this falls back to the 9.0 host rows below.
  const previewOf = new Map((previews ?? []).map((p) => [p.url, p]));
  // The ranked-source card: numbered to match the [1][2] citations in the
  // answer. The coloured chip is a local letter avatar, NOT an icon fetch —
  // pulling icons from third parties would leak what you read.
  return (
    <div className="ai-card ai-sources">
      <p className="ai-card-heading">
        <GlobeIcon className="w-3.5 h-3.5" /> Sources
      </p>
      <div className="space-y-0.5">
        {sources.map((u, k) => {
          let host = u;
          let path = '';
          try {
            const parsed = new URL(u);
            host = parsed.hostname.replace(/^www\./, '');
            path = parsed.pathname.length > 1 ? parsed.pathname : '';
          } catch {
            /* show the raw string */
          }
          const hue = (host.charCodeAt(0) * 47 + host.length * 13) % 360;
          return (
            <a
              key={k}
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-card px-1.5 py-1 hover:bg-[var(--ai-hover)] transition-colors min-w-0"
            >
              <span className="text-[10px] font-bold ai-t3 w-6 shrink-0">[{k + 1}]</span>
              <span
                aria-hidden
                className="w-[18px] h-[18px] rounded-md flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                style={{ background: `hsl(${hue} 55% 42%)` }}
              >
                {host.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                {(() => {
                  const preview = previewOf.get(u);
                  if (!preview?.title && !preview?.snippet) {
                    return (
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-semibold ai-t2 truncate">{host}</span>
                        {path && <span className="text-[11px] ai-t3 truncate hidden sm:inline min-w-0">{path}</span>}
                      </span>
                    );
                  }
                  return (
                    <span className="block min-w-0">
                      <span className="block text-[12px] font-semibold ai-t1 ai-src-title">{preview.title || host}</span>
                      {preview.snippet && <span className="block text-[11px] ai-t3 ai-src-snippet">{preview.snippet}</span>}
                      <span className="block text-[10px] ai-t3 truncate">{host}</span>
                    </span>
                  );
                })()}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="ai-tool"
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon />} <span className="ai-tool-label">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** 9.0 — a turn with no reply: the honest line, and the next useful step.
 *  Retry when asking again can help; when VinaX AI is switched off or out
 *  for the day, the music side still works, so the notice points there. */
function ReplyNotice({ m, last, busy, onRetry }: { m: Msg; last: boolean; busy: boolean; onRetry: () => void }): ReactNode {
  return (
    <div className="ai-notice">
      <span className="ai-notice-icon" aria-hidden>
        <WaveIcon />
      </span>
      <div className="ai-notice-text">
        <p>{m.content}</p>
        {!busy && last && (
          <div className="ai-notice-actions" role="group" aria-label="Reply actions">
            {m.failed ? (
              <button type="button" onClick={onRetry} className="ai-btn ai-btn-accent" aria-label="Retry this question" title="Ask again">
                <RefreshIcon /> Retry
              </button>
            ) : (
              <>
                <Link to="/radio" className="ai-btn">
                  Start AI Radio
                </Link>
                <Link to="/" className="ai-btn">
                  Back to music
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  m,
  index,
  last,
  streaming,
  busy,
  speaking,
  speakKey,
  agent,
  handlers,
}: {
  m: Msg;
  index: number;
  last: boolean;
  /** This is the reply being written right now. */
  streaming: boolean;
  busy: boolean;
  speaking: boolean;
  speakKey: string;
  /** Agent mode is on for the turn in flight (waiting copy only). */
  agent: boolean;
  handlers: MessageHandlers;
}): ReactNode {
  const more: MoreAction[] = last
    ? [
        { label: 'Continue', icon: <ContinueIcon />, onClick: handlers.continueReply },
        { label: 'Shorten', icon: <ShortenIcon />, onClick: () => handlers.rewrite('shorter') },
        { label: 'Expand', icon: <ExpandIcon />, onClick: () => handlers.rewrite('longer') },
        { label: 'Simplify', icon: <SimplifyIcon />, onClick: () => handlers.rewrite('simpler') },
      ]
    : [];
  const waiting = streaming && !m.content;
  // 8.2.0 / 9.0 — no reply arrived: a notice with one next step instead of the
  // reply toolbar (Copy / Good response make no sense on a failure line).
  const noReply = !streaming && !!m.content && (m.failed || m.unavailable);
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-assistant ai-enter">
      <span className={cn('ai-msg-mark', waiting && 'is-waiting')} aria-hidden>
        <SparkleIcon filled />
      </span>
      <div className="min-w-0 flex-1">
        <Images images={m.images} />
        {m.steps?.length ? <AgentActivity steps={m.steps} working={streaming} /> : null}
        {m.player ? (
          <ChatPlayerCard fallback={m.content} />
        ) : noReply ? (
          <ReplyNotice m={m} last={last} busy={busy} onRetry={handlers.regenerate} />
        ) : m.content ? (
          <>
            {/* Markdown renders LIVE while streaming (an unclosed fence shows
                as preformatted text until it completes). ONE element type
                either way: swapping the wrapper at the same child index made
                React remount the whole subtree the instant a reply finished,
                which re-ran every live preview from scratch. */}
            <div>
              <RichContent text={streaming ? hideFollowupLine(m.content) : m.content} streaming={streaming} />
              {streaming && <span className="ai-caret" aria-hidden />}
            </div>
            {!busy && (
              <div className="ai-toolbar mt-2 -ml-2 flex flex-wrap items-center gap-0.5" role="group" aria-label="Reply actions">
                <CopyButton text={m.content} />
                {readAloudSupported() && (
                  <button
                    type="button"
                    onClick={() => readAloud(speakKey, m.content)}
                    aria-label={speaking ? 'Stop reading' : 'Read aloud'}
                    title={speaking ? 'Stop reading' : 'Read aloud'}
                    aria-pressed={speaking}
                    className="ai-tool"
                  >
                    <SpeakerIcon />
                  </button>
                )}
                {last && (
                  <button type="button" onClick={handlers.regenerate} aria-label="Regenerate" title="Regenerate" className="ai-tool">
                    <RefreshIcon />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlers.rate(index, 'up')}
                  aria-label="Good response"
                  title="Good response"
                  aria-pressed={m.rating === 'up'}
                  className="ai-tool"
                >
                  <ThumbUpIcon />
                </button>
                <button
                  type="button"
                  onClick={() => handlers.rate(index, 'down')}
                  aria-label="Bad response"
                  title="Bad response"
                  aria-pressed={m.rating === 'down'}
                  className="ai-tool"
                >
                  <ThumbDownIcon />
                </button>
                <button
                  type="button"
                  onClick={() => handlers.branch(index)}
                  aria-label="Branch"
                  title="Branch — continue from this point in a new chat"
                  className="ai-tool"
                >
                  <BranchIcon />
                </button>
                <button
                  type="button"
                  onClick={() => handlers.togglePin(index)}
                  aria-label={m.pinned ? 'Unpin' : 'Pin'}
                  title={m.pinned ? 'Unpin' : 'Pin to the top of this chat'}
                  aria-pressed={!!m.pinned}
                  className="ai-tool"
                >
                  <PinIcon />
                </button>
                <MoreMenu actions={more} />
                {m.engine ? (
                  <span className="ai-engine-chip" title="Engine that answered">
                    {m.engine}
                  </span>
                ) : null}
              </div>
            )}
            {!busy && last && m.followups?.length ? <FollowupChips items={m.followups} disabled={busy} onPick={handlers.send} /> : null}
          </>
        ) : (
          <ThinkingMark agent={agent} />
        )}
        {m.sources?.length ? <Sources sources={m.sources} previews={m.sourcePreviews} /> : null}
      </div>
    </div>
  );
});
