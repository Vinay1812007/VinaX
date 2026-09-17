import { memo, useEffect, useState, type ReactNode } from 'react';
import { ChatPlayerCard } from '@/components/ChatPlayerCard';
import { GlobeIcon, SparkleIcon } from '@/components/Icons';
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
        <img key={k} src={src} alt="attachment" className="w-24 h-24 object-cover rounded-lg" />
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
      {!busy && (
        <div className="ai-toolbar mt-1 -mr-1">
          <button type="button" onClick={() => handlers.edit(index, m.content)} className="ai-tool">
            <PencilIcon className="w-3 h-3" /> Edit
          </button>
        </div>
      )}
    </div>
  );
});

const WAITING = ['Thinking…', 'Reading your question…', 'Gathering ideas…', 'Putting it together…'];
const WAITING_AGENT = ['Working…', 'Planning the steps…', 'Looking things up…', 'Checking the details…'];

/** The pause before the first token: the VinaX mark breathing beside a short
 *  status that changes every couple of seconds. The accessible name stays
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
      <span key={i} className="ai-thinking-text" aria-hidden>
        {lines[i]}
      </span>
    </span>
  );
}

function Sources({ sources }: { sources: string[] }): ReactNode {
  // The ranked-source card: numbered to match the [1][2] citations in the
  // answer. The coloured chip is a local letter avatar, NOT an icon fetch —
  // pulling icons from third parties would leak what you read.
  return (
    <div className="ai-card mt-3 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider ai-t3 mb-1.5 flex items-center gap-1">
        <GlobeIcon className="w-3 h-3" /> Sources
      </p>
      <div className="space-y-0.5">
        {sources.map((u, k) => {
          let host = u;
          let path = '';
          try {
            const parsed = new URL(u);
            host = parsed.hostname.replace(/^www\./, '');
            path = parsed.pathname.length > 1 ? parsed.pathname.slice(0, 40) : '';
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
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--ai-hover)] transition-colors min-w-0"
            >
              <span className="text-[10px] font-bold ai-t3 w-6 shrink-0">[{k + 1}]</span>
              <span
                aria-hidden
                className="w-[18px] h-[18px] rounded-md flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                style={{ background: `hsl(${hue} 55% 42%)` }}
              >
                {host.charAt(0).toUpperCase()}
              </span>
              <span className="text-[11px] font-semibold ai-t2 truncate">{host}</span>
              {path && <span className="text-[10px] ai-t3 truncate hidden sm:inline">{path}</span>}
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
      {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon />} {copied ? 'Copied' : 'Copy'}
    </button>
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
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-assistant ai-enter">
      <span className={cn('ai-msg-mark', streaming && !m.content && 'ai-pulse')} aria-hidden>
        <SparkleIcon className="w-[15px] h-[15px]" />
      </span>
      <div className="min-w-0 flex-1">
        <Images images={m.images} />
        {m.steps?.length ? <AgentActivity steps={m.steps} working={streaming} /> : null}
        {m.player ? (
          <ChatPlayerCard fallback={m.content} />
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
              <div className="ai-toolbar mt-2 -ml-1.5 flex flex-wrap items-center gap-0.5" role="group" aria-label="Reply actions">
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
        {m.sources?.length ? <Sources sources={m.sources} /> : null}
      </div>
    </div>
  );
});
