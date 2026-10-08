import { memo, useEffect, useState, type ReactNode } from 'react';
import { EngineContext } from './ChatStyleScope';
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
import { CheckIcon, CodeIcon, GlobeIcon } from './icons';
import { MediaCard } from './MediaCard';
import { CODE_TOOL, isProviderId, WEB_TOOL } from './models';
import { ProviderLogo } from './ProviderLogo';
import type { ModelChoice, Msg, MsgSources } from './types';
import { readPickIssue } from './streamClient';
import { AUTO } from './models';

/** Everything a message can ask the page to do. The object is stable (see
 *  useStableHandlers), so memoised messages do not re-render with the page. */
export type MessageHandlers = {
  edit: (index: number, content: string) => void;
  rate: (index: number, rating: 'up' | 'down') => void;
  togglePin: (index: number) => void;
  branch: (index: number) => void;
  regenerate: () => void;
  /** 11.2 — ask the last question again with another model (or Auto). */
  askWith: (choice: ModelChoice) => void;
  /** 11.0 — put the last message back in the box (it was turned away). */
  reviseLast: () => void;
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

/** 11.0 — the text of an attached file travels INSIDE the message (the model
 *  has to read it, and Edit / Retry must send it again), but the bubble shows
 *  one compact chip per file instead of the raw text — a 300-line file used to
 *  make a bubble thousands of pixels tall. Chats stored before 11.0 hold the
 *  same folded text, so they are read the same way. */
const FILE_MARK = /\n\n--- File: ([^\n]+?)( \(excerpt\))? ---\n/g;
export type AttachedText = { path: string; excerpt: boolean; text: string };
export function splitAttachedText(content: string): { typed: string; files: AttachedText[] } {
  const marks = Array.from(content.matchAll(FILE_MARK));
  if (!marks.length) return { typed: content, files: [] };
  const files = marks.map((mark, k) => ({
    path: mark[1],
    excerpt: !!mark[2],
    text: content.slice((mark.index ?? 0) + mark[0].length, marks[k + 1]?.index),
  }));
  return { typed: content.slice(0, marks[0].index), files };
}

const fileKind = (path: string): string => {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(path)?.[1]?.toUpperCase();
  return ext === 'PDF' ? 'PDF' : ext ? `${ext} file` : 'Text file';
};

function AttachedFile({ file }: { file: AttachedText }): ReactNode {
  const [open, setOpen] = useState(false);
  const name = file.path.split('/').pop() || file.path;
  const lines = file.text ? file.text.replace(/\n+$/, '').split('\n').length : 0;
  return (
    <details
      className="ai-file-chip mt-2 first:mt-0 max-w-full rounded-xl border border-ink-500/30 bg-ink-950/15 text-left"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold" title={file.path}>
            {name}
          </span>
          <span className="block text-xs opacity-75">
            {fileKind(file.path)} · {lines === 1 ? '1 line' : `${lines.toLocaleString()} lines`}
            {file.excerpt ? ' · excerpt' : ''}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium underline underline-offset-2">{open ? 'Hide contents' : 'Show contents'}</span>
      </summary>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-ink-500/30 px-3 py-2 font-mono text-xs" tabIndex={0}>
          {file.text}
        </pre>
      )}
    </details>
  );
}

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
  const { typed, files } = splitAttachedText(m.content);
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-user ai-enter">
      <div className="ai-user-bubble" onDoubleClick={() => handlers.edit(index, m.content)} title="Double-tap to edit & resend">
        <Images images={m.images} />
        {typed.trim() ? <p className="whitespace-pre-wrap">{typed}</p> : null}
        {files.map((f, k) => (
          <AttachedFile key={k} file={f} />
        ))}
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
/** 10.3 — what the wait says while a picture or a clip is being made. */
const CREATING: Record<'image' | 'music', string[]> = {
  image: ['Creating your picture…', 'Adding the details…'],
  music: ['Composing your clip…', 'Mixing it down…'],
};

/** 10.3 — the reply ran code: the Run code tool was on for the model that
 *  answered AND the reply holds a code block (the code and its output). */
export const ranCode = (m: Pick<Msg, 'tools' | 'content'>): boolean => !!m.tools?.includes(CODE_TOOL) && m.content.includes('```');
/** 11.0 — web search was on for the model that answered (stream meta). */
export const searchedWeb = (m: Pick<Msg, 'tools'>): boolean => !!m.tools?.includes(WEB_TOOL);

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** 11.0 — the pages a web-grounded reply drew on: up to 8 pills (the page's
 *  title, else its host; no favicons, no remote images) opening in a new tab,
 *  a "Searched the web" caption when the model ran queries, and the provider's
 *  search-suggestion snippet in a sealed frame (empty sandbox: no scripts, no
 *  same-origin, no navigation) — showing that snippet is a condition of the
 *  grounding service. Exported for tests. */
export function Sources({ s }: { s: MsgSources }): ReactNode {
  if (!s.items.length && !s.entry) return null;
  return (
    <div className="ai-sources" role="group" aria-label="Sources">
      {s.queries.length > 0 && (
        <span className="ai-sources-cap">
          <GlobeIcon className="w-3.5 h-3.5" />
          Searched the web
        </span>
      )}
      {s.items.length > 0 && (
        <ul className="ai-sources-list">
          {s.items.slice(0, 8).map((it) => {
            const host = hostOf(it.url);
            return (
              <li key={it.url}>
                <a className="ai-source" href={it.url} target="_blank" rel="noopener noreferrer" title={it.title ? `${it.title} — ${host}` : host}>
                  {it.title || host}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {s.entry && <iframe className="ai-sources-entry" sandbox="" srcDoc={s.entry} title="Search suggestions" tabIndex={-1} loading="lazy" />}
    </div>
  );
}

/** The pause before the first token: beside it the VinaX mark turns slowly
 *  and breathes in the Marigold → Rose glow (.ai-msg-mark.is-waiting), and this
 *  short status runs a soft shimmer, changing every couple of seconds. The
 *  accessible name stays "Thinking" — a screen reader hears it once, not every
 *  rotation. */
function ThinkingMark({ creating }: { creating?: 'image' | 'music' }): ReactNode {
  const lines = creating ? CREATING[creating] : WAITING;
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
function ReplyNotice({
  m,
  last,
  busy,
  onRetry,
  onEdit,
  onAskWith,
}: {
  m: Msg;
  last: boolean;
  busy: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onAskWith: (choice: ModelChoice) => void;
}): ReactNode {
  // 11.2 — the picked model gave no answer. Stored chats are read back
  // as they were saved, so the stored copy is validated again here.
  const issue = m.failed ? readPickIssue(m.pickIssue) : null;
  // Asking the same model again right away cannot help when it is out for the
  // day, not free, or gone.
  const retryHelps = !issue || issue.reason === 'busy' || issue.reason === 'down';
  return (
    <div className="ai-notice">
      <span className="ai-notice-icon" aria-hidden>
        <WaveIcon />
      </span>
      <div className="ai-notice-text">
        <p>{m.content}</p>
        {!busy && last && (
          <div className="ai-notice-actions" role="group" aria-label="Reply actions">
            {issue ? (
              <>
                {retryHelps && (
                  <button type="button" onClick={onRetry} className="ai-btn ai-btn-accent" aria-label={`Ask ${issue.name} again`} title="Ask again">
                    <RefreshIcon /> Retry
                  </button>
                )}
                {issue.alternatives.slice(0, 2).map((alt) => (
                  <button
                    key={alt.model}
                    type="button"
                    className="ai-btn"
                    title={`Ask this question again with ${alt.name}`}
                    onClick={() => onAskWith({ mode: 'model', provider: alt.provider, model: alt.model, name: alt.name })}
                  >
                    <ProviderLogo provider={alt.provider} size={14} />
                    Ask {alt.name}
                  </button>
                ))}
                <button type="button" className="ai-btn" title="Ask this question again and let VinaX AI choose the model" onClick={() => onAskWith(AUTO)}>
                  Use Auto
                </button>
              </>
            ) : m.failed && m.needsEdit ? (
              // 11.0 — sending the same thing again would only fail again.
              <button type="button" onClick={onEdit} className="ai-btn ai-btn-accent" title="Put this message back in the box to change it">
                <PencilIcon /> Edit message
              </button>
            ) : m.failed ? (
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
  // 11.0 — an empty reply that nothing is writing any more (the page was
  // reloaded or left mid-reply) is a failed turn too, never an endless
  // thinking mark.
  const interrupted = !streaming && !m.content && !m.media && !m.player;
  const noReply = interrupted || (!streaming && !!m.content && (m.failed || m.unavailable));
  return (
    <div id={`ai-msg-${index}`} className="ai-msg ai-msg-assistant ai-enter">
      <span className={cn('ai-msg-mark', markState)} aria-hidden>
        <SparkleIcon filled />
      </span>
      <div className="min-w-0 flex-1">
        <Images images={m.images} />
        {m.media ? (
          // 10.3 — a picture or a clip made with Create image / Create music clip.
          <MediaCard media={m.media} />
        ) : m.player ? (
          <ChatPlayerCard fallback={m.content} />
        ) : noReply ? (
          <ReplyNotice
            m={interrupted ? { ...m, content: 'No reply — try again', failed: true, unavailable: undefined } : m}
            last={last}
            busy={busy}
            onRetry={handlers.regenerate}
            onEdit={handlers.reviseLast}
            onAskWith={handlers.askWith}
          />
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
            {/* 11.0 — the pages a web-grounded reply drew on, once it has finished. */}
            {!streaming && m.sources && <Sources s={m.sources} />}
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
                {/* 10.3 — the model ran code for this reply (the Run code connector). */}
                {ranCode(m) && (
                  <span className="ai-engine-chip ai-ran-code" title="The model ran code for this reply">
                    <CodeIcon className="w-3.5 h-3.5" />
                    Ran code
                  </span>
                )}
                {/* 11.0 — web search was on for this reply: a small globe. */}
                {searchedWeb(m) && (
                  <span className="ai-engine-chip ai-web-chip" title="Web search was on for this reply">
                    <GlobeIcon className="w-3.5 h-3.5" />
                    <span className="sr-only">Web search on</span>
                  </span>
                )}
                {m.engine ? (
                  <span className="ai-engine-chip" title={`Answered by ${m.engine}`}>
                    {isProviderId(m.engineProvider) && <ProviderLogo provider={m.engineProvider} size={14} />}
                    <span className="truncate">{m.engine}</span>
                    <EngineContext engine={m.engine} />
                  </span>
                ) : null}
              </div>
            )}
            {!busy && last && m.followups?.length ? <FollowupChips items={m.followups} disabled={busy} onPick={handlers.send} /> : null}
          </>
        ) : (
          <ThinkingMark creating={m.creating} />
        )}
      </div>
    </div>
  );
});
