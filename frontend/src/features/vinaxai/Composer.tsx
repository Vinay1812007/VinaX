/**
 * VinaX AI — the composer: a rounded card with an auto-growing text area.
 * Enter sends, Shift+Enter adds a line; Send becomes Stop while a reply is
 * being written.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpIcon, StopIcon } from './icons';
import { ModelPicker } from './ModelPicker';
import { PlusMenu } from './PlusMenu';
import type { PickerModel } from './types';

interface Props {
  value: string;
  onChange(v: string): void;
  onSend(): void;
  onStop(): void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** The picker's models; without them the composer shows "Auto" and no picker. */
  models?: PickerModel[];
  model?: string;
  onModel?(id: string): void;
  thinking?: boolean;
  onThinking?(v: boolean): void;
}

export interface ComposerHandle { focus(): void }

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ value, onChange, onSend, onStop, streaming, disabled, placeholder, models, model, onModel, thinking, onThinking }, ref): ReactNode {
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
  }), []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const canSend = !disabled && !streaming && value.trim().length > 0;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSend) onSend();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="vx-ai-composer" onSubmit={submit}>
      <label htmlFor="vx-ai-input" className="sr-only">Message VinaX AI</label>
      <textarea
        id="vx-ai-input"
        ref={area}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? 'Message VinaX AI'}
        disabled={disabled}
        enterKeyHint="send"
        autoComplete="off"
      />
      <div className="vx-ai-composer-row">
        <div className="vx-ai-composer-tools">
          {onThinking && <PlusMenu thinking={!!thinking} onThinking={onThinking} />}
          {thinking && <span className="vx-ai-pill">Extended thinking</span>}
        </div>
        {models && onModel ? <ModelPicker models={models} value={model ?? 'auto'} onChange={onModel} /> : <span className="vx-ai-composer-mode">Auto</span>}
        {/* Separate keys: React must not turn the clicked Stop button into a
            submit button mid-click, or the browser would finish that click as
            a submit and send the restored text again. */}
        {streaming ? (
          <button key="stop" type="button" className="vx-ai-send is-stop" onClick={onStop} aria-label="Stop">
            <StopIcon className="w-4 h-4" />
          </button>
        ) : (
          <button key="send" type="submit" className="vx-ai-send" disabled={!canSend} aria-label="Send message">
            <ArrowUpIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </form>
  );
});
