/**
 * VinaX AI — the composer: a rounded card with an auto-growing text area.
 * Enter sends, Shift+Enter adds a line; Send becomes Stop while a reply is
 * being written.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ACCEPT } from './files';
import { ArrowUpIcon, StopIcon } from './icons';
import { ModelPicker } from './ModelPicker';
import { PlusMenu, type WebSearch } from './PlusMenu';
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
  /** Present when web search is offered. */
  search?: { value: WebSearch; onChange(v: WebSearch): void };
  /** Files: the tray shown above the text, and new files picked, pasted or dropped. */
  tray?: ReactNode;
  onFiles?(files: File[]): void;
  /** Files are ready to send even without text. */
  hasFiles?: boolean;
  /** Why Send is held back (files still being added, a model that cannot see). */
  sendBlocked?: boolean;
}

export interface ComposerHandle { focus(): void }

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ value, onChange, onSend, onStop, streaming, disabled, placeholder, models, model, onModel, thinking, onThinking, search, tray, onFiles, hasFiles, sendBlocked }, ref): ReactNode {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
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

  const canSend = !disabled && !streaming && !sendBlocked && (value.trim().length > 0 || !!hasFiles);
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (pasted.length && onFiles) {
      e.preventDefault();
      onFiles(pasted);
    }
  };
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
      {tray}
      {onFiles && (
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to add"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = '';
            if (picked.length) onFiles(picked);
          }}
        />
      )}
      <label htmlFor="vx-ai-input" className="sr-only">Message VinaX AI</label>
      <textarea
        id="vx-ai-input"
        ref={area}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder ?? 'Message VinaX AI'}
        disabled={disabled}
        enterKeyHint="send"
        autoComplete="off"
      />
      <div className="vx-ai-composer-row">
        <div className="vx-ai-composer-tools">
          {onThinking && <PlusMenu thinking={!!thinking} onThinking={onThinking} search={search} onAddFiles={onFiles ? () => picker.current?.click() : undefined} />}
          {search?.value === 'on' && <span className="vx-ai-pill">Web search</span>}
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
