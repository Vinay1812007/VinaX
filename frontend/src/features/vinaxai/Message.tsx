/**
 * VinaX AI — one message. The listener's sits in a soft bubble on the
 * right; VinaX AI's is full-width prose with its reasoning folded above it
 * and its actions (Copy, Retry, the model that answered) below.
 */
import { memo, useState, type ReactNode } from 'react';
import { Markdown } from './Markdown';
import { copyText } from './CodeBlock';
import { ChevronIcon, CopyIcon, RetryIcon } from './icons';
import type { ChatMessage } from './types';

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

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }): ReactNode {
  return (
    <div className="vx-ai-turn vx-ai-turn-user">
      <h2 className="sr-only">You said</h2>
      <div className="vx-ai-bubble">{message.text}</div>
    </div>
  );
});

interface ReplyProps {
  message: ChatMessage;
  live: boolean;
  onRetry?: () => void;
}

export function AssistantMessage({ message, live, onRetry }: ReplyProps): ReactNode {
  const { text, error, stopReason, model } = message;
  const waiting = live && !text && !message.thinking && !error;
  return (
    <div className="vx-ai-turn vx-ai-turn-reply" aria-busy={live || undefined}>
      <h2 className="sr-only">VinaX AI said</h2>
      <ThinkingFold message={message} live={live} />
      {waiting && <span className="vx-ai-pending" role="status" aria-label="VinaX AI is writing"><i /><i /><i /></span>}
      {text && <Markdown text={text} />}
      {live && text && <span className="vx-ai-cursor" aria-hidden />}
      {!live && stopReason === 'length' && !error && <p className="vx-ai-note">The reply was cut short.</p>}
      {!live && stopReason === 'aborted' && <p className="vx-ai-note">Stopped.</p>}
      {error && (
        <div className="vx-ai-error" role="alert">
          <p>{error.message}</p>
          {onRetry && error.retryable && (
            <button type="button" className="vx-ai-chip" onClick={onRetry}>
              <RetryIcon className="w-4 h-4" /> Retry
            </button>
          )}
        </div>
      )}
      {!live && (text || model) && (
        <div className="vx-ai-actions">
          {text && (
            <button type="button" className="vx-ai-act" onClick={() => void copyText(text)} aria-label="Copy reply" title="Copy">
              <CopyIcon className="w-4 h-4" />
            </button>
          )}
          {onRetry && !error && (
            <button type="button" className="vx-ai-act" onClick={onRetry} aria-label="Retry" title="Retry">
              <RetryIcon className="w-4 h-4" />
            </button>
          )}
          {model && <span className="vx-ai-model">{model.name} · {model.provider}</span>}
        </div>
      )}
    </div>
  );
}
