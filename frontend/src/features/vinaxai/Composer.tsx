/**
 * VinaX AI — the composer: a rounded card with an auto-growing text area.
 * Enter sends, Shift+Enter adds a line; Send becomes Stop while a reply is
 * being written. Beside the + menu sits the Thinking menu (Auto, Fast,
 * Standard, Extended, Maximum). The mic dictates into the text (never sends by itself);
 * with nothing typed, the Live voice button stands where Send goes.
 * Create image (from the + menu) turns the composer into a picture prompt:
 * an "Image" pill with ×, its own placeholder and length limit, and Send
 * makes the picture instead of a reply.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ACCEPT } from './files';
import { ArrowUpIcon, CheckIcon, CloseIcon, ImageIcon, MicIcon, ResearchIcon, StopIcon, WaveIcon } from './icons';
import { ModelPicker } from './ModelPicker';
import { PlusMenu, type WebSearch } from './PlusMenu';
import { ThinkingPicker } from './ThinkingPicker';
import type { PickerModel, ThinkingChoice, ThinkingLevel } from './types';
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
  thinking?: ThinkingChoice;
  onThinking?(v: ThinkingChoice): void;
  /** The levels Auto can give. */
  autoThinking?: ThinkingLevel[];
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
  /** Create image, when the owner has it on: whether the composer is in it now, and how to switch. */
  image?: { on: boolean; maxPrompt: number; onChange(on: boolean): void };
  /** Research, when the owner offers it: on, the next messages run several searches and answer with a report. */
  research?: { on: boolean; onChange(on: boolean): void };
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

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ value, onChange, onSend, onStop, streaming, disabled, placeholder, models, model, onModel, thinking, onThinking, autoThinking, search, tray, onFiles, hasFiles, sendBlocked, dictation, onLive, onSettings, image, research }, ref): ReactNode {
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

  const imaging = !!image?.on;
  /** The box's name and placeholder: what it is for right now. */
  const hint = imaging ? 'Describe the image you want' : research?.on ? 'What should VinaX AI research?' : placeholder ?? 'Message VinaX AI';
  const canSend = !disabled && !streaming && (imaging
    ? value.trim().length > 0 && value.trim().length <= (image?.maxPrompt ?? Infinity)
    : !sendBlocked && (value.trim().length > 0 || !!hasFiles));
  const dictating = !!dictation && dictation.phase !== 'idle';
  const showLive = !!onLive && !imaging && !streaming && !value.trim() && !hasFiles;
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
      <label htmlFor="vx-ai-input" className="sr-only">{hint}</label>
      <textarea
        id="vx-ai-input"
        ref={area}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={hint}
        maxLength={imaging ? image?.maxPrompt : undefined}
        disabled={disabled}
        enterKeyHint="send"
        autoComplete="off"
      />
      {dictation && dictating ? <RecordingBar d={dictation} /> : (
      <div className="vx-ai-composer-row">
        <div className="vx-ai-composer-tools">
          <PlusMenu search={search} onAddFiles={onFiles ? () => picker.current?.click() : undefined} onCreateImage={image && !imaging ? () => image.onChange(true) : undefined} research={research} onSettings={onSettings} />
          {onThinking && (
            <ThinkingPicker
              value={thinking ?? 'auto'}
              onChange={onThinking}
              model={model && model !== 'auto' ? models?.find((m) => m.id === model) ?? null : null}
              models={models ?? []}
              autoLevels={autoThinking}
              disabled={disabled}
            />
          )}
          {imaging && (
            <span className="vx-ai-pill vx-ai-pill-image">
              <ImageIcon className="w-3.5 h-3.5" /> Image
              <button type="button" className="vx-ai-pill-x" onClick={() => image?.onChange(false)} aria-label="Stop creating an image">
                <CloseIcon className="w-3 h-3" />
              </button>
            </span>
          )}
          {!imaging && research?.on && (
            <span className="vx-ai-pill vx-ai-pill-image vx-ai-pill-research">
              <ResearchIcon className="w-3.5 h-3.5" /> Research
              <button type="button" className="vx-ai-pill-x" onClick={() => research.onChange(false)} aria-label="Turn off Research">
                <CloseIcon className="w-3 h-3" />
              </button>
            </span>
          )}
          {!imaging && !research?.on && search?.value === 'on' && <span className="vx-ai-pill">Web search</span>}
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
          <button key="send" type="submit" className="vx-ai-send" disabled={!canSend} aria-label={imaging ? 'Create image' : 'Send message'}>
            <ArrowUpIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      )}
    </form>
  );
});
