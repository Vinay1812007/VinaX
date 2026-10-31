/**
 * VinaX AI — the composer: a rounded card with an auto-growing text area.
 * Enter sends, Shift+Enter adds a line; Send becomes Stop while a reply is
 * being written. The mic dictates into the text (never sends by itself);
 * with nothing typed, the Live voice button stands where Send goes.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ACCEPT } from './files';
import { ArrowUpIcon, CheckIcon, CloseIcon, MicIcon, StopIcon, WaveIcon } from './icons';
import { ModelPicker } from './ModelPicker';
import { PlusMenu, type WebSearch } from './PlusMenu';
import type { PickerModel } from './types';
import type { Dictation } from './useVoiceDictation';

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
  /** Dictation, when it is offered. */
  dictation?: Dictation;
  /** Open Live voice, when it is offered. */
  onLive?(): void;
  /** Open VinaX AI settings (from the + menu). */
  onSettings?(): void;
}

export interface ComposerHandle { focus(): void }

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The recording bar that stands in for the tools while dictating. */
function RecordingBar({ d }: { d: Dictation }): ReactNode {
  if (d.phase === 'transcribing') {
    return <div className="vx-ai-rec" role="status"><span className="vx-ai-rec-spin" aria-hidden /> Transcribing…</div>;
  }
  return (
    <div className="vx-ai-rec">
      <button type="button" className="vx-ai-icon-btn" onClick={d.cancel} aria-label="Cancel dictation">
        <CloseIcon className="w-5 h-5" />
      </button>
      <span className="vx-ai-rec-dot" aria-hidden />
      <span className="vx-ai-rec-time" role="status" aria-label={d.phase === 'starting' ? 'Starting the microphone' : `Recording, ${d.seconds} seconds`}>
        {d.phase === 'starting' ? '…' : clock(d.seconds)}
      </span>
      {d.silent
        ? <span className="vx-ai-rec-silent" role="status">No sound from your mic</span>
        : <span className="vx-ai-rec-meter" aria-hidden style={{ ['--vx-rec-level' as string]: String(d.level) }}><i /><i /><i /><i /><i /></span>}
      <button type="button" className="vx-ai-send" onClick={d.finish} disabled={d.phase !== 'recording'} aria-label="Finish dictation">
        <CheckIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ value, onChange, onSend, onStop, streaming, disabled, placeholder, models, model, onModel, thinking, onThinking, search, tray, onFiles, hasFiles, sendBlocked, dictation, onLive, onSettings }, ref): ReactNode {
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
  const dictating = !!dictation && dictation.phase !== 'idle';
  const showLive = !!onLive && !streaming && !value.trim() && !hasFiles;
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
      {dictation && dictating ? <RecordingBar d={dictation} /> : (
      <div className="vx-ai-composer-row">
        <div className="vx-ai-composer-tools">
          {onThinking && <PlusMenu thinking={!!thinking} onThinking={onThinking} search={search} onAddFiles={onFiles ? () => picker.current?.click() : undefined} onSettings={onSettings} />}
          {search?.value === 'on' && <span className="vx-ai-pill">Web search</span>}
          {thinking && <span className="vx-ai-pill">Extended thinking</span>}
        </div>
        {models && onModel ? <ModelPicker models={models} value={model ?? 'auto'} onChange={onModel} /> : <span className="vx-ai-composer-mode">Auto</span>}
        {dictation?.supported && !streaming && (
          <button type="button" className="vx-ai-icon-btn" onClick={dictation.start} disabled={disabled} aria-label="Dictate" title="Dictate">
            <MicIcon className="w-5 h-5" />
          </button>
        )}
        {/* Separate keys: React must not turn the clicked Stop button into a
            submit button mid-click, or the browser would finish that click as
            a submit and send the restored text again. */}
        {streaming ? (
          <button key="stop" type="button" className="vx-ai-send is-stop" onClick={onStop} aria-label="Stop">
            <StopIcon className="w-4 h-4" />
          </button>
        ) : showLive ? (
          <button key="live" type="button" className="vx-ai-send" onClick={onLive} disabled={disabled} aria-label="Start Live voice" title="Live voice">
            <WaveIcon className="w-4 h-4" />
          </button>
        ) : (
          <button key="send" type="submit" className="vx-ai-send" disabled={!canSend} aria-label="Send message">
            <ArrowUpIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      )}
    </form>
  );
});
