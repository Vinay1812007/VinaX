/**
 * VinaX AI — one message. The listener's sits in a soft bubble on the
 * right, with Edit on hover (an edit becomes a new version beside the old
 * one). VinaX AI's is full-width prose with its reasoning folded above it and
 * its actions below: Copy, Retry (with a model menu), Continue when it was
 * cut off, and the model that answered. Messages with more than one version
 * get a ‹ 2 / 3 › switcher.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { copyText } from './CodeBlock';
import { siblingsOf } from './chatState';
import { selectBranch, useChatStore, type ModelChoice } from './store';
import { moveFocus, useDismiss } from './useDismiss';
import { ProgressLine, SearchStatusLine, SourcesRow } from './Sources';
import { MessageFiles } from './FileChips';
import { ArtifactCard } from './ArtifactPanel';
import { parseArtifacts, runsInSandbox, type Artifact, mayHaveArtifacts } from './artifacts';
import { InlinePreview } from './InlinePreview';
import { ReplyActionsContext } from './ChoiceBlocks';
import { usePrefs } from './prefs';
import { ChevronDownSmallIcon, ChevronIcon, ContinueIcon, CopyIcon, PencilIcon, RetryIcon, SpeakerIcon, StopIcon, ThinkIcon } from './icons';
import { readAloud, stopReading, useReadAloud } from './readAloud';
import { isFoundModel, type ChatMessage, type PickerModel } from './types';
import { THINKING_LABELS } from './ThinkingPicker';

export const thoughtLabel = (ms: number | null): string => (ms == null ? 'Thought process' : `Thought for ${Math.max(1, Math.round(ms / 1000))}s`);

/** Seconds since this reply started, ticking while it is still thinking. */
function useElapsed(running: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [running]);
  return Math.max(0, Math.round((now - start) / 1_000));
}

/**
 * The reasoning, folded above the answer the way Claude shows it: from the
 * moment the question is sent a "Thinking…" header with a live timer; the
 * reasoning streams into a short scrolling box (it follows the newest line
 * unless the listener scrolls up); once the answer starts it folds to
 * "Thought for 12s", and opens again on a tap. The listener can fold or
 * open it at any time, also while it is still thinking.
 */
export function ThinkingFold({ message, live, waiting = false }: { message: ChatMessage; live: boolean; waiting?: boolean }): ReactNode {
  const [choice, setChoice] = useState<boolean | null>(null);
  const stillThinking = live && !message.text && !message.error;
  const elapsed = useElapsed(stillThinking);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const thinking = message.thinking;
  const expanded = (choice ?? stillThinking) && !!thinking;
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stillThinking && follow.current) el.scrollTop = el.scrollHeight;
  }, [thinking, stillThinking, expanded]);
  if (!thinking && !(stillThinking && waiting)) return null;
  const label = stillThinking ? 'Thinking' : thoughtLabel(message.thinkingMs);
  return (
    <div className={`vx-ai-think${expanded ? ' is-open' : ''}${stillThinking ? ' is-live' : ''}`}>
      <button
        type="button"
        className="vx-ai-think-toggle"
        aria-expanded={thinking ? expanded : undefined}
        onClick={() => { if (thinking) setChoice(!expanded); }}
        aria-label={stillThinking ? `Thinking, ${elapsed} seconds` : undefined}
      >
        <ThinkIcon className={`vx-ai-think-icon w-4 h-4${stillThinking ? ' vx-ai-pulse' : ''}`} />
        <span className={stillThinking ? 'vx-ai-shimmer' : undefined}>{label}{stillThinking ? '…' : ''}</span>
        {stillThinking && elapsed > 0 && <span className="vx-ai-think-time">{elapsed}s</span>}
        {thinking && <ChevronDownSmallIcon className="vx-ai-think-chev w-4 h-4" />}
      </button>
      {expanded && (
        <div
          ref={body}
          className={`vx-ai-think-body${stillThinking ? ' is-streaming' : ''}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          <Markdown text={thinking} />
        </div>
      )}
    </div>
  );
}

/** ‹ 2 / 3 › between the versions of a message (edits of a question, retries of an answer). */
export function BranchSwitcher({ message }: { message: ChatMessage }): ReactNode {
  const messages = useChatStore((s) => s.messages);
  const siblings = useMemo(() => siblingsOf(messages, message), [messages, message]);
  const streaming = useChatStore((s) => s.streaming);
  if (siblings.length < 2) return null;
  const i = siblings.findIndex((m) => m.id === message.id);
  const go = (d: number) => {
    const next = siblings[i + d];
    if (next) selectBranch(next.id);
  };
  return (
    <div className="vx-ai-branch" role="group" aria-label="Versions">
      <button type="button" className="vx-ai-act" aria-label="Previous version" disabled={streaming || i <= 0} onClick={() => go(-1)}>
        <ChevronIcon className="w-4 h-4 rotate-180" />
      </button>
      <span className="vx-ai-branch-n">{i + 1} / {siblings.length}</span>
      <button type="button" className="vx-ai-act" aria-label="Next version" disabled={streaming || i >= siblings.length - 1} onClick={() => go(1)}>
        <ChevronIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

interface UserProps {
  message: ChatMessage;
  onEdit?(text: string): void;
}

export const UserMessage = memo(function UserMessage({ message, onEdit }: UserProps): ReactNode {
  const streaming = useChatStore((s) => s.streaming);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const start = () => {
    setDraft(message.text);
    setEditing(true);
  };
  const save = () => {
    const t = draft.trim();
    setEditing(false);
    if ((t || message.files?.length) && t !== message.text.trim()) onEdit?.(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  };
  return (
    <div className="vx-ai-turn vx-ai-turn-user">
      <h2 className="sr-only">You said</h2>
      {editing ? (
        <div className="vx-ai-edit">
          <label className="sr-only" htmlFor={`edit-${message.id}`}>Edit your message</label>
          <textarea id={`edit-${message.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={Math.min(10, Math.max(2, draft.split('\n').length))} autoFocus />
          <div className="vx-ai-edit-row">
            <button type="button" className="vx-ai-chip" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="vx-ai-chip is-primary" onClick={save} disabled={!draft.trim()}>Send</button>
          </div>
        </div>
      ) : (
        <>
          {message.files?.length ? <MessageFiles files={message.files} /> : null}
          {message.text && <div className="vx-ai-bubble">{message.text}</div>}
          <div className="vx-ai-user-actions">
            <BranchSwitcher message={message} />
            {onEdit && !message.local && (
              <button type="button" className="vx-ai-act vx-ai-hover" onClick={start} disabled={streaming} aria-label="Edit message" title="Edit">
                <PencilIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});

/** Retry, and a small menu to retry with Auto or another model. */
function RetryMenu({ models, onRetry }: { models: PickerModel[]; onRetry(choice?: ModelChoice): void }): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [button, menu]);
  const pick = (choice: ModelChoice) => {
    setOpen(false);
    onRetry(choice);
  };
  const item = (key: string, label: string, choice: ModelChoice) => (
    <div key={key} role="menuitem" tabIndex={-1} className="vx-ai-menu-item" onClick={() => pick(choice)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(choice); } }}>
      {label}
    </div>
  );
  return (
    <span className="vx-ai-retry">
      <button type="button" className="vx-ai-act" onClick={() => onRetry()} aria-label="Retry" title="Retry">
        <RetryIcon className="w-4 h-4" />
      </button>
      <button
        ref={button}
        type="button"
        className="vx-ai-act vx-ai-act-narrow"
        aria-label="Retry with…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => moveFocus(menu.current, '[role="menuitem"]', 'first'));
        }}
      >
        <ChevronDownSmallIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Retry with"
          className="vx-ai-pop vx-ai-retry-menu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(menu.current, '[role="menuitem"]', 1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(menu.current, '[role="menuitem"]', -1); }
          }}
        >
          {item('auto', 'Retry with Auto', { mode: 'auto' })}
          {models.filter((m) => m.available && !isFoundModel(m)).map((m) => item(m.id, `Retry with ${m.name}`, { mode: 'model', model: m.id }))}
        </div>
      )}
    </span>
  );
}

interface ReplyProps {
  message: ChatMessage;
  live: boolean;
  models: PickerModel[];
  /** Which version of each artifact this reply holds (1 = first), and how to open one. */
  versionOf?(id: string, messageId: string): number;
  onOpenArtifact?(artifact: Artifact, messageId: string): void;
  /** A failed live preview's "Fix it". */
  onFixArtifact?(artifact: Artifact, error: string): void;
  onRetry?(choice?: ModelChoice): void;
  onContinue?(): void;
  /** Read aloud is offered. */
  canReadAloud?: boolean;
  /** The latest reply: a questions block's answers are sent as the next message. */
  onAnswer?(text: string): void;
}

/** Read aloud: the speaker under a reply; Stop while this reply is being read. */
function ReadAloudButton({ id, text }: { id: string; text: string }): ReactNode {
  const reading = useReadAloud((s) => (s.messageId === id ? s.phase : 'idle'));
  const on = reading !== 'idle';
  return (
    <button
      type="button"
      className={`vx-ai-act${on ? ' is-on' : ''}`}
      onClick={() => (on ? stopReading() : void readAloud(id, text))}
      aria-label={on ? 'Stop reading' : 'Read aloud'}
      aria-pressed={on}
      title={on ? 'Stop reading' : 'Read aloud'}
    >
      {on ? <StopIcon className={`w-4 h-4${reading === 'loading' ? ' vx-ai-pulse' : ''}`} /> : <SpeakerIcon className="w-4 h-4" />}
    </button>
  );
}

/** "14:05" (or the date too when it was not today), for the footer. */
export function timeLabel(iso: string, now = new Date()): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === now.toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * The footer's account of how the reply was made: the model, the thinking
 * level it answered at (when not Standard), what Auto judged the message to
 * be, and a note when the level asked for was not on that model.
 */
export function RouteInfo({ message }: { message: ChatMessage }): ReactNode {
  const { model, routing, createdAt } = message;
  const when = timeLabel(createdAt);
  const t = routing?.thinking;
  const level = t && t.used !== 'standard' ? `${THINKING_LABELS[t.used]} thinking` : null;
  // Only for a level the listener chose: under Auto thinking the level is VinaX AI's own call.
  const fellBack = t && t.choice !== 'auto' && t.used !== t.level && model ? `${THINKING_LABELS[t.level]} thinking isn’t available on ${model.name}, so it used ${THINKING_LABELS[t.used]}.` : null;
  const auto = routing?.route ? `Auto: ${routing.route.task}${routing.route.complexity === 'hard' ? ', hard' : routing.route.complexity === 'simple' ? ', simple' : ''}` : null;
  return (
    <span className="vx-ai-route">
      {model && <span className="vx-ai-model">{[`${model.name} · ${model.provider}`, level, auto].filter(Boolean).join(' · ')}</span>}
      {when && <time className="vx-ai-time" dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{when}</time>}
      {fellBack && <span className="vx-ai-route-note">{fellBack}</span>}
    </span>
  );
}

export function AssistantMessage({ message, live, models, onRetry, onContinue, versionOf, onOpenArtifact, onFixArtifact, canReadAloud, onAnswer }: ReplyProps): ReactNode {
  const { text, error, stopReason, model } = message;
  const waiting = live && !text && !message.thinking && !error && !message.status && !message.progress;
  const cutOff = !live && !!text && (stopReason === 'length' || stopReason === 'error');
  const previews = usePrefs((p) => p.inlinePreviews && p.artifacts);
  const actions = useMemo(() => ({ live, answer: onAnswer }), [live, onAnswer]);
  return (
    <ReplyActionsContext.Provider value={actions}>
    <div className="vx-ai-turn vx-ai-turn-reply" data-message-id={message.id} aria-busy={live || undefined}>
      <h2 className="sr-only">VinaX AI said</h2>
      {live && !text && message.status && <SearchStatusLine status={message.status} />}
      {live && !text && !message.thinking && !message.status && message.progress && <ProgressLine progress={message.progress} />}
      <ThinkingFold message={message} live={live} waiting={waiting} />
      {waiting && <span className="sr-only" role="status">VinaX AI is thinking</span>}
      {text && (mayHaveArtifacts(text)
        ? parseArtifacts(text).map((seg, i) => (seg.kind === 'text'
          ? <Markdown key={i} text={seg.text} sources={message.sources?.items} />
          : (
            <div key={i} className="vx-ai-artifact-slot">
              <ArtifactCard artifact={seg.artifact} live={live} version={versionOf?.(seg.artifact.id, message.id) ?? 1} onOpen={() => onOpenArtifact?.(seg.artifact, message.id)} />
              {previews && !live && !seg.artifact.incomplete && runsInSandbox(seg.artifact.type) && <InlinePreview artifact={seg.artifact} onFix={onFixArtifact ? (error) => onFixArtifact(seg.artifact, error) : undefined} onOpen={onOpenArtifact ? () => onOpenArtifact(seg.artifact, message.id) : undefined} />}
            </div>
          )))
        : <Markdown text={text} sources={message.sources?.items} />)}
      {live && text && <span className="vx-ai-cursor" aria-hidden />}
      {!live && message.sources && <SourcesRow sources={message.sources} />}
      {!live && stopReason === 'length' && !error && <p className="vx-ai-note">The reply was cut short.</p>}
      {!live && stopReason === 'aborted' && <p className="vx-ai-note">Stopped.</p>}
      {error && (
        <div className="vx-ai-error" role="alert">
          <p>{error.message}</p>
          {onRetry && error.retryable && (
            <div className="vx-ai-error-actions">
              {cutOff && onContinue && (
                <button type="button" className="vx-ai-chip is-primary" onClick={onContinue}>
                  <ContinueIcon className="w-4 h-4" /> Continue
                </button>
              )}
              <button type="button" className="vx-ai-chip" onClick={() => onRetry()}>
                <RetryIcon className="w-4 h-4" /> Retry
              </button>
              {error.alternatives && (
                <>
                  <button type="button" className="vx-ai-chip" onClick={() => onRetry({ mode: 'auto' })}>Try with Auto</button>
                  {error.alternatives.map((a) => (
                    <button key={a.id} type="button" className="vx-ai-chip" onClick={() => onRetry({ mode: 'model', model: a.id })}>
                      Try {a.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!live && (text || model) && (
        <div className="vx-ai-actions">
          <BranchSwitcher message={message} />
          {text && (
            <button type="button" className="vx-ai-act" onClick={() => void copyText(text)} aria-label="Copy reply" title="Copy">
              <CopyIcon className="w-4 h-4" />
            </button>
          )}
          {canReadAloud && text && <ReadAloudButton id={message.id} text={text} />}
          {onRetry && !error && <RetryMenu models={models} onRetry={onRetry} />}
          {cutOff && !error && onContinue && (
            <button type="button" className="vx-ai-chip vx-ai-continue" onClick={onContinue}>
              <ContinueIcon className="w-4 h-4" /> Continue
            </button>
          )}
          <RouteInfo message={message} />
        </div>
      )}
    </div>
    </ReplyActionsContext.Provider>
  );
}
