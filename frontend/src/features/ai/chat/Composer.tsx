import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDownIcon, PlusIcon, WaveformIcon, XIcon } from '@/components/Icons';
import { SlashMenu } from '@/components/ai/AiExtras';
import {
  ATTACHMENT_ACCEPT,
  pickerFiles,
  prepareAttachments,
  type Attachment,
  type FileSelection,
} from '@/features/ai/attachments';
import { matchSlash, type SlashCommand } from '@/features/ai/slashCommands';
import { cn } from '@/utils/cn';
import type { CodeSupport } from '@/features/ai/connectors';
import { ConnectorChips, ConnectorList, useConnectors } from './Connectors';
import { BookIcon, CheckIcon, ClipIcon, FolderIcon, ImageIcon, MicIcon, SendIcon, StopIcon, UploadIcon } from './icons';
import type { CreateKind } from './media';
import { ProviderLogo } from './ProviderLogo';
import type { AiFeatures, MediaPick, ProviderId } from './types';
import { useDictation } from './useDictation';
import { formatClock, MAX_RECORD_MS, recorderSupported, useServerDictation, type ServerDictationFailure } from './useServerDictation';

/** What the page can do to the composer from outside (edit & resend, quick
 *  actions, saved prompts, files dropped on the conversation). */
export interface ComposerHandle {
  setText: (text: string) => void;
  getText: () => string;
  focus: () => void;
  addFiles: (selection: FileSelection) => void;
}

export interface ComposerProps {
  busy: boolean;
  /** Pinned to the bottom of a conversation (false: centred on an empty chat). */
  docked: boolean;
  modelLabel: string;
  /** 10.3 — the chosen model's provider, for its logo on the chip (null = Auto). */
  modelProvider: ProviderId | null;
  menuOpen: boolean;
  /** `anchor` is the chip's box, so the page can place the menu on screen. */
  onToggleMenu: (anchor: DOMRect) => void;
  /** The model menu, rendered by the page so Settings can share it. */
  menu: ReactNode;
  think: boolean;
  onThink: (on: boolean) => void;
  /** 10.0 — the song playing now rides with the message (the Now playing connector). */
  songCtx: boolean;
  onSongCtx: (on: boolean) => void;
  /** 10.3 — Create image / Create music clip is on for the next message. */
  createKind: CreateKind | null;
  onCreateKind: (kind: CreateKind | null) => void;
  /** 10.3 — the bar naming what will be made and by which model (page-rendered). */
  createBar: ReactNode;
  /** 10.3 — which kinds of model the server reaches (all off until the list is read). */
  features: AiFeatures;
  /** 10.3 — the + menu opened: the page reads the model list (once, cached). */
  onToolsOpen: () => void;
  /** 10.3 — whether the model in use can run code (the Run code connector). */
  codeSupport: CodeSupport;
  /** 10.3 — the server dictation model, or null for this device's dictation. */
  dictationPick: MediaPick | null;
  canSpeech: boolean;
  voiceMode: boolean;
  onToggleVoice: () => void;
  sendOnEnter: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenPrompts: () => void;
}

const LINE_PX = 24;
const MAX_ROWS = 8;

/**
 * v7.1 — the composer: one rounded container holding an auto-growing text
 * box (1–8 rows) over a single control row. Left: attach / tools (+).
 * Right: the model chip, live voice, the mic, and send — which
 * becomes stop while a reply streams.
 *
 * It owns its own text and attachments. Typing used to set state on the page,
 * which re-rendered the entire conversation on every keystroke.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref): ReactNode {
  const {
    busy,
    docked,
    modelLabel,
    modelProvider,
    menuOpen,
    onToggleMenu,
    menu,
    think,
    onThink,
    songCtx,
    onSongCtx,
    createKind,
    onCreateKind,
    createBar,
    features,
    onToolsOpen,
    codeSupport,
    dictationPick,
    canSpeech,
    voiceMode,
    onToggleVoice,
    sendOnEnter,
    onSend,
    onStop,
    onOpenPrompts,
  } = props;

  const [text, setText] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  // 9.1.0 — which file is being read, and a way to stop part-way. A folder of
  // PDFs can take real seconds, and "Reading selected files…" with no end in
  // sight and no way out was the whole of the feedback before.
  const [progress, setProgress] = useState<{ done: number; total: number; path: string } | null>(null);
  const readAbort = useRef<AbortController | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  // 11.0 — where the + menu opens and how tall it may be, measured from the
  // composer on each open: below when there is room (an empty chat has the
  // composer mid-screen), above when it would run off the bottom, and never
  // taller than the space on that side.
  const [toolsPlace, setToolsPlace] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 480 });
  const composerRef = useRef<HTMLDivElement | null>(null);
  const measureTools = useCallback((): void => {
    const el = composerRef.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 20;
    const above = r.top - 20;
    const up = below < 320 && above > below;
    setToolsPlace({ up, maxHeight: Math.max(200, Math.min(608, up ? above : below)) });
  }, []);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // 11.0 — this device's dictation hands over a rolling transcript of the
  // whole utterance, so it is written AFTER what was in the box when listening
  // began, not over it. Sending closes the gate (null), so a result that
  // lands late cannot refill the box that was just emptied.
  const textRef = useRef(text);
  textRef.current = text;
  const dictationDraft = useRef<string | null>(null);
  // 11.0 — and what is typed WHILE listening stays too: each result replaces
  // only the words dictation wrote last time, in the box as it is now.
  const heardRef = useRef<Heard>({ at: -1, text: '', said: '', skip: 0 });
  const dictation = useDictation((t) => {
    if (dictationDraft.current === null) return;
    const merged = mergeDictation(textRef.current, heardRef.current, t);
    heardRef.current = merged.heard;
    textRef.current = merged.text;
    setText(merged.text);
  });
  const startDictation = (): void => {
    dictationDraft.current = textRef.current;
    heardRef.current = { at: -1, text: '', said: '', skip: 0 };
    dictation.start();
  };
  // 10.3 — a server dictation model, when one is chosen: record, send, insert.
  // Any failure falls back to this device's dictation with a quiet note.
  const [serverNote, setServerNote] = useState('');
  const recorder = useServerDictation({
    pick: dictationPick,
    onText: (t) => {
      setServerNote('');
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t));
      taRef.current?.focus();
    },
    onFallback: (why: ServerDictationFailure) => {
      if (canSpeech) {
        setServerNote(
          why === 'denied'
            ? 'Microphone access is blocked for recording — trying this device’s dictation instead.'
            : 'The dictation model didn’t work this time — listening on this device instead.',
        );
        startDictation();
      } else {
        setServerNote(
          why === 'denied'
            ? 'Microphone access is blocked — allow the mic for VinaX, then try again.'
            : 'The dictation model didn’t work this time — try again in a moment.',
        );
      }
    },
  });
  useEffect(() => {
    if (!serverNote) return;
    const t = window.setTimeout(() => setServerNote(''), 8000);
    return () => window.clearTimeout(t);
  }, [serverNote]);
  const useServerMic = !!dictationPick && recorderSupported();
  const showMic = canSpeech || useServerMic;
  const recording = recorder.state === 'recording';
  // 11.0 — the microphone is still opening (permission prompt, slow device).
  const micStarting = recorder.state === 'starting';
  const transcribing = recorder.state === 'sending';
  const onMic = (): void => {
    if (recording || micStarting) return recorder.stop();
    if (transcribing) return;
    if (dictation.listening) return dictation.stop();
    setServerNote('');
    if (useServerMic) recorder.start();
    else startDictation();
  };
  const connectors = useConnectors({
    think,
    nowPlaying: songCtx,
    onThink,
    onNowPlaying: onSongCtx,
    code: { available: features.code, support: codeSupport },
  });

  // Auto-grow, 1–8 rows. A layout effect (not the change handler) because the
  // text is also set from outside: dictation, edit & resend, saved prompts.
  useLayoutEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, LINE_PX * MAX_ROWS)}px`;
  }, [text]);

  // A keyboard device lands in the box; a touch device does not get its
  // on-screen keyboard thrown open by a page load.
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;
    taRef.current?.focus({ preventScroll: true });
  }, []);

  const addFiles = useCallback(async (selection: FileSelection): Promise<void> => {
    if (!selection.files.length && !selection.notices.length) return;
    const controller = new AbortController();
    readAbort.current = controller;
    setReading(true);
    setProgress(null);
    try {
      const result = await prepareAttachments(selection, pendingRef.current, {
        signal: controller.signal,
        onProgress: (done, total, path) => setProgress({ done, total, path }),
      });
      setPending(result.attachments);
      setNotice(result.notices.join(' '));
      window.setTimeout(() => setNotice(''), 9000);
    } finally {
      if (readAbort.current === controller) readAbort.current = null;
      setReading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setText: (t: string) => {
        setText(t);
        taRef.current?.focus();
      },
      getText: () => taRef.current?.value ?? '',
      focus: () => taRef.current?.focus(),
      addFiles: (selection: FileSelection) => void addFiles(selection),
    }),
    [addFiles],
  );

  const submit = (value: string): void => {
    // 11.0 — files still being read are not in `pending` yet: sending now
    // would leave them behind, so wait for the read (or its Stop).
    if (busy || reading || (!value.trim() && pending.length === 0)) return;
    // A dictation result that lands after this must not refill the box.
    dictationDraft.current = null;
    if (dictation.listening) dictation.stop();
    const files = pending;
    setText('');
    setPending([]);
    onSend(value, files);
  };

  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const closeTools = (): void => {
    setToolsOpen(false);
    toolsBtnRef.current?.focus();
  };
  // 10.0 — a small non-modal dialog (it holds switches, which a menu may not):
  // focus moves in when it opens, arrows walk its buttons, Escape closes.
  const toolsItems = (): HTMLElement[] => [...(toolsMenuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
  useEffect(() => {
    if (toolsOpen) toolsMenuRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [toolsOpen]);
  const onToolsKey = (e: KeyboardEvent): void => {
    if (!toolsOpen) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeTools();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = toolsItems();
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const slashItems = matchSlash(text);

  return (
    <div className={cn('ai-composer-wrap', docked && 'ai-composer-docked')}>
      <div className="ai-column">
        {reading && (
          <div id="ai-composer-reading" className="ai-attachment-status ai-t2" role="status">
            <span className="vx-wave-loader" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {progress && progress.total > 1
              ? `Reading ${progress.done} of ${progress.total} — ${progress.path}`
              : progress
                ? `Reading ${progress.path}`
                : 'Reading selected files…'}
            <button type="button" className="ai-attachment-stop" onClick={() => readAbort.current?.abort()}>
              Stop
            </button>
          </div>
        )}
        {notice && (
          <div className="ai-attachment-notice" role="status">
            {notice}
          </div>
        )}
        <ConnectorChips active={connectors.active} armed={connectors.armed} memoryCount={connectors.memoryCount} onToggle={connectors.toggle} />
        {createBar}
        {/* 10.3 — recording for a server dictation model: a timer and Stop. */}
        {(micStarting || recording || transcribing) && (
          <div className="ai-record" role="status">
            <span className={cn('ai-record-dot', transcribing && 'is-sending')} aria-hidden />
            <span className="ai-record-time">
              {micStarting ? 'Waiting for the microphone…' : transcribing ? 'Turning your voice into text…' : `Recording ${formatClock(recorder.elapsed)} / ${formatClock(MAX_RECORD_MS)}`}
            </span>
            <span className="flex-1" />
            {micStarting && (
              <button type="button" className="ai-btn ai-record-cancel" onClick={recorder.cancel}>
                Cancel
              </button>
            )}
            {recording && (
              <>
                <button type="button" className="ai-btn ai-record-cancel" onClick={recorder.cancel}>
                  Cancel
                </button>
                <button type="button" className="ai-btn ai-btn-accent" onClick={recorder.stop}>
                  <StopIcon className="w-3.5 h-3.5" /> Stop
                </button>
              </>
            )}
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {pending.map((p, i) => (
              <span key={p.key} className="ai-chip ai-attachment-chip pl-1.5 pr-1 py-1 gap-1.5" title={p.path}>
                {p.kind === 'image' && p.dataUrl ? (
                  <img src={p.dataUrl} alt="" className="w-6 h-6 object-cover" />
                ) : (
                  <span className="ai-attachment-kind w-6 h-6 bg-[var(--ai-hover)] flex items-center justify-center text-[9px] font-bold ai-t3" aria-hidden>
                    TXT
                  </span>
                )}
                <span className="max-w-[12rem] truncate">{p.path}</span>
                <button
                  type="button"
                  aria-label={`Remove ${p.path}`}
                  onClick={() => setPending((prev) => prev.filter((_, k) => k !== i))}
                  className="ai-icon-btn w-7 h-7 ai-t3"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="ai-composer" ref={composerRef}>
          <SlashMenu
            items={slashItems}
            onPick={(c: SlashCommand) => {
              if (c.arg) {
                setText(`/${c.cmd} `);
                taRef.current?.focus();
              } else {
                submit(`/${c.cmd}`);
              }
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => void addFiles(pickerFiles(e.target.files ? Array.from(e.target.files) : []))}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => void addFiles(pickerFiles(e.target.files ? Array.from(e.target.files) : []))}
          />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && text.startsWith('/') && !/\s/.test(text)) {
                const first = slashItems[0];
                if (first) {
                  e.preventDefault();
                  setText(first.arg ? `/${first.cmd} ` : `/${first.cmd}`);
                }
                return;
              }
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              const chord = e.metaKey || e.ctrlKey;
              // Send-on-Enter off: Enter is a new line, Ctrl/⌘+Enter sends.
              if (chord || (sendOnEnter && !e.shiftKey)) {
                e.preventDefault();
                submit(text);
              }
            }}
            rows={1}
            placeholder={
              createKind === 'image'
                ? 'Describe the image to create…'
                : createKind === 'music'
                  ? 'Describe the music clip to create…'
                  : recording
                    ? 'Recording…'
                    : dictation.listening
                  ? 'Listening…'
                  : 'Message VinaX AI…'
            }
            aria-label="Message VinaX AI"
            className="ai-composer-input ai-t1"
          />

          <div className="ai-composer-row">
            {/* ---- left cluster: attach / tools ---- */}
            <div className="relative" onKeyDown={onToolsKey}>
              <button
                ref={toolsBtnRef}
                type="button"
                onClick={() => {
                  if (!toolsOpen) {
                    measureTools();
                    onToolsOpen();
                  }
                  setToolsOpen((v) => !v);
                }}
                aria-label="Attach and tools"
                title="Attach files, connectors and tools"
                aria-haspopup="dialog"
                aria-expanded={toolsOpen}
                className={cn('ai-icon-btn ai-round', toolsOpen && 'ai-icon-btn-on')}
              >
                <PlusIcon className={cn('ai-plus w-[18px] h-[18px]', toolsOpen && 'ai-plus-open')} />
              </button>
              {toolsOpen && (
                <>
                  <button type="button" aria-label="Close tools menu" tabIndex={-1} onClick={() => setToolsOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <div
                    ref={toolsMenuRef}
                    role="dialog"
                    aria-label="Attach and tools"
                    className={cn('ai-popover ai-tools-menu ai-pop', docked || toolsPlace.up ? 'ai-tools-menu-up' : 'ai-tools-menu-down')}
                    style={{ '--ai-menu-max': `${toolsPlace.maxHeight}px` } as React.CSSProperties}
                  >
                    <div role="group" aria-label="Attach">
                      <button
                        type="button"
                        className="ai-menu-item"
                        onClick={() => {
                          setToolsOpen(false);
                          fileRef.current?.click();
                        }}
                      >
                        <UploadIcon className="w-4 h-4 ai-t3" /> Upload files
                      </button>
                      <button
                        type="button"
                        className="ai-menu-item"
                        onClick={() => {
                          setToolsOpen(false);
                          folderRef.current?.click();
                        }}
                      >
                        <FolderIcon className="w-4 h-4 ai-t3" /> Upload folder
                      </button>
                    </div>
                    <div className="ai-menu-sep" />
                    <ConnectorList views={connectors.views} armed={connectors.armed} memoryCount={connectors.memoryCount} onToggle={connectors.toggle} />
                    <div className="ai-menu-sep" />
                    {/* 10.3 — shown only when the server reaches a model of that kind. */}
                    {(features.image || features.music) && (
                      <div role="group" aria-label="Create">
                        {features.image && (
                          <button
                            type="button"
                            aria-pressed={createKind === 'image'}
                            className="ai-menu-item"
                            onClick={() => {
                              onCreateKind(createKind === 'image' ? null : 'image');
                              setToolsOpen(false);
                              taRef.current?.focus();
                            }}
                            title="Your next message describes a picture to make"
                          >
                            <ImageIcon className="w-4 h-4 ai-t3" />
                            <span className="flex-1">Create image</span>
                            {createKind === 'image' && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                          </button>
                        )}
                        {features.music && (
                          <button
                            type="button"
                            aria-pressed={createKind === 'music'}
                            className="ai-menu-item"
                            onClick={() => {
                              onCreateKind(createKind === 'music' ? null : 'music');
                              setToolsOpen(false);
                              taRef.current?.focus();
                            }}
                            title="Your next message describes a short music clip to make"
                          >
                            <ClipIcon className="w-4 h-4 ai-t3" />
                            <span className="flex-1">Create music clip</span>
                            {createKind === 'music' && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                          </button>
                        )}
                        <div className="ai-menu-sep" />
                      </div>
                    )}
                    <button
                      type="button"
                      className="ai-menu-item"
                      onClick={() => {
                        setToolsOpen(false);
                        onOpenPrompts();
                      }}
                    >
                      <BookIcon className="w-4 h-4 ai-t3" /> Saved prompts
                    </button>
                  </div>
                </>
              )}
            </div>

            <span className="flex-1" />

            {/* ---- right cluster: model, live voice, mic, send ---- */}
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={(e) => onToggleMenu(e.currentTarget.getBoundingClientRect())}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                aria-label={`Model: ${modelLabel}`}
                title="Choose model"
                className={cn('ai-chip ai-model-chip', menuOpen && 'ai-chip-on')}
              >
                {modelProvider && <ProviderLogo provider={modelProvider} size={16} />}
                <span className="truncate">{modelLabel}</span>
                <ChevronDownIcon className={cn('ai-model-chevron w-3 h-3 shrink-0', menuOpen && 'rotate-180')} />
              </button>
              {menu}
            </div>
            {canSpeech && (
              <button
                type="button"
                onClick={onToggleVoice}
                aria-pressed={voiceMode}
                aria-label="Live voice chat"
                title="Live voice chat"
                className={cn('ai-icon-btn ai-round', voiceMode && 'ai-icon-btn-on')}
              >
                <WaveformIcon className="w-[18px] h-[18px]" />
              </button>
            )}
            {showMic && (
              <button
                type="button"
                onClick={onMic}
                aria-label={recording ? 'Stop recording' : micStarting ? 'Cancel voice input' : 'Voice input'}
                aria-pressed={dictation.listening || recording || micStarting}
                title={recording ? 'Stop and turn into text' : micStarting ? 'Cancel' : 'Speak'}
                disabled={transcribing}
                className={cn('ai-icon-btn ai-round', (dictation.listening || recording) && 'ai-icon-btn-on ai-pulse')}
              >
                <MicIcon className="w-[18px] h-[18px]" />
              </button>
            )}
            {busy ? (
              <button type="button" onClick={onStop} aria-label="Stop" title="Stop (Esc)" className="ai-send ai-send-stop">
                <StopIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => submit(text)}
                disabled={reading || (!text.trim() && pending.length === 0)}
                aria-label="Send"
                aria-describedby={reading ? 'ai-composer-reading' : undefined}
                title={reading ? 'Send unlocks when your files have been read' : 'Send'}
                className="ai-send"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <p className="ai-composer-status" role={serverNote || dictation.note ? 'status' : undefined}>
          {serverNote || dictation.note ? (
            <span className="is-note">{serverNote || dictation.note}</span>
          ) : busy && think ? (
            <span className="is-thinking ai-shimmer">Thinking it through…</span>
          ) : think ? (
            <span className="is-on">Think on</span>
          ) : (
            <span className="hidden sm:inline">
              {sendOnEnter ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl/⌘+Enter to send · Enter for a new line'} · / for commands
            </span>
          )}
        </p>
      </div>
    </div>
  );
});

/** 11.0 — what device dictation last wrote into the box: where, which words,
 *  the whole utterance at that moment, and how much of the utterance to leave
 *  out from now on (the part the listener has since rewritten by hand). */
type Heard = { at: number; text: string; said: string; skip: number };

/** Device dictation reports the whole utterance so far, each time. Put it in
 *  the box as the box is NOW: replace the words written last time (wherever
 *  typing has moved them) and keep everything else. If those words are gone —
 *  the listener rewrote them — only what is said from here on is added. */
function mergeDictation(box: string, prev: Heard, said: string): { text: string; heard: Heard } {
  const at = !prev.text ? -1 : box.startsWith(prev.text, prev.at) ? prev.at : box.lastIndexOf(prev.text);
  if (at >= 0) {
    const piece = prev.skip ? said.slice(prev.skip).trimStart() : said;
    return { text: box.slice(0, at) + piece + box.slice(at + prev.text.length), heard: { ...prev, at, text: piece, said } };
  }
  const skip = prev.text ? Math.min(prev.said.length, said.length) : prev.skip;
  const piece = skip ? said.slice(skip).trimStart() : said;
  const head = box.trim() ? `${box.replace(/\s+$/, '')} ` : '';
  return { text: piece ? head + piece : box, heard: { at: head.length, text: piece, said, skip } };
}
