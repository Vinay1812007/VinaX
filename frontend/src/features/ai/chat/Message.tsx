import { memo, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChatPlayerCard } from '@/components/ChatPlayerCard';
import { SparkleIcon, WaveIcon } from '@/components/Icons';
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
import { CheckIcon } from './icons';
import { isProviderId } from './models';
import { ProviderLogo } from './ProviderLogo';
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

/** The pause before the first token: beside it the VinaX mark turns slowly
 *  and breathes in the Marigold → Rose glow (.ai-msg-mark.is-waiting), and this
 *  short status runs a soft shimmer, changing every couple of seconds. The
 *  accessible name stays "Thinking" — a screen reader hears it once, not every
 *  rotation. */
function ThinkingMark(): ReactNode {
  const lines = WAITING;
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
  // 10.0 — the mark has three states: turning in the glow while it waits for
  // the first word, glowing while the words arrive, and settled once they stop.
  const markState = waiting ? 'is-waiting' : streaming ? 'is-streaming' : undefined;
  // 8.2.0 / 9.0 — no reply arrived: a notice with one next step instead of the
  // reply toolbar (Copy / Good response make no sense on a failure line).
  const noReply = !streaming && !!m.content && (m.failed || m.unavailable);
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-assistant ai-enter">
      <span className={cn('ai-msg-mark', markState)} aria-hidden>
        <SparkleIcon filled />
      </span>
      <div className="min-w-0 flex-1">
        <Images images={m.images} />
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
            {/* 10.0 — while it streams, each new block fades in (opacity only,
                once, as it mounts; text already on screen never re-animates)
                and a small Marigold mark pulses where the words end: drawn
                after the last paragraph or list item by CSS, or by the span
                below when the reply ends in a block such as code. */}
            <div className={cn('ai-reply', streaming && 'is-streaming')}>
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
                {/* 10.3 — who answered: the provider's logo and the model's
                    original name, straight from the stream (a failover hop
                    names the engine that really replied). A reply stored by an
                    older build keeps its label, without a logo. */}
                {m.engine ? (
                  <span className="ai-engine-chip" title={`Answered by ${m.engine}`}>
                    {isProviderId(m.engineProvider) && <ProviderLogo provider={m.engineProvider} size={14} />}
                    <span className="truncate">{m.engine}</span>
                  </span>
                ) : null}
              </div>
            )}
            {!busy && last && m.followups?.length ? <FollowupChips items={m.followups} disabled={busy} onPick={handlers.send} /> : null}
          </>
        ) : (
          <ThinkingMark />
        )}
      </div>
    </div>
  );
});
