/**
 * VinaX AI — one message. The listener's sits in a soft bubble on the
 * right, with Edit on hover (an edit becomes a new version beside the old
 * one). VinaX AI's is full-width prose with its reasoning folded above it and
 * its actions below: Copy, Retry (with a model menu), Continue when it was
 * cut off, and the model that answered. Messages with more than one version
 * get a ‹ 2 / 3 › switcher.
 */
import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { copyText } from './CodeBlock';
import { siblingsOf } from './chatState';
import { selectBranch, useChatStore, type ModelChoice } from './store';
import { moveFocus, useDismiss } from './useDismiss';
import { SearchStatusLine, SourcesRow } from './Sources';
import { ChevronDownSmallIcon, ChevronIcon, ContinueIcon, CopyIcon, PencilIcon, RetryIcon } from './icons';
import type { ChatMessage, PickerModel } from './types';

export const thoughtLabel = (ms: number | null): string => (ms == null ? 'Thought process' : `Thought for ${Math.max(1, Math.round(ms / 1000))}s`);

export function ThinkingFold({ message, live }: { message: ChatMessage; live: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  const stillThinking = live && !message.text;
  if (!message.thinking) return null;
  const expanded = stillThinking || open;
  return (
    <div className={`vx-ai-think${expanded ? ' is-open' : ''}`}>
      <button type="button" className="vx-ai-think-toggle" aria-expanded={expanded} onClick={() => setOpen((o) => !o)} disabled={stillThinking}>
        <span className={stillThinking ? 'vx-ai-shimmer' : undefined}>{stillThinking ? 'Thinking…' : thoughtLabel(message.thinkingMs)}</span>
        {!stillThinking && <ChevronIcon className="vx-ai-think-chev w-3.5 h-3.5" />}
      </button>
      {expanded && <div className="vx-ai-think-body">{message.thinking}</div>}
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
    if (t && t !== message.text.trim()) onEdit?.(t);
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
          <div className="vx-ai-bubble">{message.text}</div>
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
          {models.filter((m) => m.available).map((m) => item(m.id, `Retry with ${m.name}`, { mode: 'model', model: m.id }))}
        </div>
      )}
    </span>
  );
}

interface ReplyProps {
  message: ChatMessage;
  live: boolean;
  models: PickerModel[];
  onRetry?(choice?: ModelChoice): void;
  onContinue?(): void;
}

export function AssistantMessage({ message, live, models, onRetry, onContinue }: ReplyProps): ReactNode {
  const { text, error, stopReason, model } = message;
  const waiting = live && !text && !message.thinking && !error && !message.status;
  const cutOff = !live && !!text && (stopReason === 'length' || stopReason === 'error');
  return (
    <div className="vx-ai-turn vx-ai-turn-reply" aria-busy={live || undefined}>
      <h2 className="sr-only">VinaX AI said</h2>
      {live && !text && message.status && <SearchStatusLine status={message.status} />}
      <ThinkingFold message={message} live={live} />
      {waiting && <span className="vx-ai-pending" role="status" aria-label="VinaX AI is writing"><i /><i /><i /></span>}
      {text && <Markdown text={text} sources={message.sources?.items} />}
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
          {onRetry && !error && <RetryMenu models={models} onRetry={onRetry} />}
          {cutOff && !error && onContinue && (
            <button type="button" className="vx-ai-chip vx-ai-continue" onClick={onContinue}>
              <ContinueIcon className="w-4 h-4" /> Continue
            </button>
          )}
          {model && <span className="vx-ai-model">{model.name} · {model.provider}</span>}
        </div>
      )}
    </div>
  );
}
