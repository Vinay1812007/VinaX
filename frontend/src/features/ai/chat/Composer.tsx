import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDownIcon, GlobeIcon, PlusIcon, WaveformIcon, XIcon } from '@/components/Icons';
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
import { IMAGES_ENABLED } from './endpoints';
import { AgentIcon, BookIcon, BulbIcon, CheckIcon, FolderIcon, MicIcon, SendIcon, StopIcon, UploadIcon } from './icons';
import { useDictation } from './useDictation';

/** What the page can do to the composer from outside (edit & resend, quick
 *  actions, saved prompts, files dropped on the conversation). */
export interface ComposerHandle {
  setText: (text: string) => void;
  getText: () => string;
  focus: () => void;
  addFiles: (selection: FileSelection) => void;
}

/** unknown: the catalogue has not been asked yet · none: it has, and no
 *  agent-capable model is being served right now. */
export type AgentAvailability = 'unknown' | 'loading' | 'available' | 'none';

export interface ComposerProps {
  busy: boolean;
  /** Pinned to the bottom of a conversation (false: centred on an empty chat). */
  docked: boolean;
  modelLabel: string;
  menuOpen: boolean;
  /** `anchor` is the chip's box, so the page can place the menu on screen. */
  onToggleMenu: (anchor: DOMRect) => void;
  /** The model menu, rendered by the page so Settings can share it. */
  menu: ReactNode;
  agentOn: boolean;
  agentAvailability: AgentAvailability;
  onToggleAgent: () => void;
  web: boolean;
  think: boolean;
  research: boolean;
  onWeb: (on: boolean) => void;
  onThink: (on: boolean) => void;
  onResearch: (on: boolean) => void;
  imageMode: boolean;
  onImageMode: (on: boolean) => void;
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
 * box (1–8 rows) over a single control row. Left: attach / tools (+) and the
 * Agent toggle. Right: the model chip, live voice, the mic, and send — which
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
    menuOpen,
    onToggleMenu,
    menu,
    agentOn,
    agentAvailability,
    onToggleAgent,
    web,
    think,
    research,
    onWeb,
    onThink,
    onResearch,
    imageMode,
    onImageMode,
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const agentHintId = useId();

  const dictation = useDictation(setText);

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
    setReading(true);
    try {
      const result = await prepareAttachments(selection, pendingRef.current);
      setPending(result.attachments);
      setNotice(result.notices.join(' '));
      window.setTimeout(() => setNotice(''), 9000);
    } finally {
      setReading(false);
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
    if (busy || (!value.trim() && pending.length === 0)) return;
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
  // A real menu: focus moves in when it opens, arrows walk it, Escape closes.
  useEffect(() => {
    if (toolsOpen) toolsMenuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [toolsOpen]);
  const onToolsKey = (e: KeyboardEvent): void => {
    if (!toolsOpen) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeTools();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...(toolsMenuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const slashItems = matchSlash(text);
  const activeTools = [web && (research ? null : 'Web search'), think && 'Think', research && 'Research'].filter(
    (t): t is string => typeof t === 'string',
  );
  const agentBlocked = agentAvailability === 'none';

  return (
    <div className={cn('ai-composer-wrap', docked && 'ai-composer-docked')}>
      <div className="ai-column">
        {reading && (
          <div className="ai-attachment-status ai-t2" role="status">
            <span className="vx-wave-loader" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Reading selected files…
          </div>
        )}
        {notice && (
          <div className="ai-attachment-notice" role="status">
            {notice}
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {pending.map((p, i) => (
              <span key={p.key} className="ai-chip ai-attachment-chip pl-1.5 pr-1 py-1 gap-1.5" title={p.path}>
                {p.kind === 'image' && p.dataUrl ? (
                  <img src={p.dataUrl} alt="" className="w-6 h-6 rounded-md object-cover" />
                ) : (
                  <span className="w-6 h-6 rounded-md bg-[var(--ai-hover)] flex items-center justify-center text-[9px] font-bold ai-t3" aria-hidden>
                    TXT
                  </span>
                )}
                <span className="max-w-[12rem] truncate">{p.path}</span>
                <button
                  type="button"
                  aria-label={`Remove ${p.path}`}
                  onClick={() => setPending((prev) => prev.filter((_, k) => k !== i))}
                  className="ai-icon-btn w-6 h-6 ai-t3"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="ai-composer">
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
              imageMode
                ? 'Describe the image to create…'
                : dictation.listening
                  ? 'Listening…'
                  : agentOn
                    ? 'Give the agent a task…'
                    : 'Message VinaX AI…'
            }
            aria-label="Message VinaX AI"
            className="ai-composer-input ai-t1"
          />

          <div className="ai-composer-row">
            {/* ---- left cluster: attach / tools, Agent ---- */}
            <div className="relative" onKeyDown={onToolsKey}>
              <button
                ref={toolsBtnRef}
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                aria-label="Attach and tools"
                title="Attach files and tools"
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
                className={cn('ai-icon-btn ai-round', toolsOpen && 'ai-icon-btn-on')}
              >
                <PlusIcon className={cn('ai-plus w-[18px] h-[18px]', toolsOpen && 'ai-plus-open')} />
                {activeTools.length > 0 && <span className="ai-dot ai-below-sm" aria-hidden />}
              </button>
              {toolsOpen && (
                <>
                  <button type="button" aria-label="Close tools menu" tabIndex={-1} onClick={() => setToolsOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <div
                    ref={toolsMenuRef}
                    role="menu"
                    aria-label="Attach and tools"
                    className={cn('ai-popover ai-tools-menu ai-pop', docked ? 'ai-tools-menu-up' : 'ai-tools-menu-down')}
                  >
                    <button
                      type="button"
                      role="menuitem"
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
                      role="menuitem"
                      className="ai-menu-item"
                      onClick={() => {
                        setToolsOpen(false);
                        folderRef.current?.click();
                      }}
                    >
                      <FolderIcon className="w-4 h-4 ai-t3" /> Upload folder
                    </button>
                    <div className="ai-menu-sep" />
                    <button type="button" role="menuitemcheckbox" aria-checked={web} className="ai-menu-item" onClick={() => onWeb(!web)} title="Search the live web for this chat">
                      <GlobeIcon className="w-4 h-4 ai-t3" /> <span className="flex-1">Web search</span>
                      {web && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={think}
                      className="ai-menu-item"
                      onClick={() => onThink(!think)}
                      title="Think — send the next message to the deep engine for careful reasoning"
                    >
                      <BulbIcon className="w-4 h-4 ai-t3" /> <span className="flex-1">Think</span>
                      {think && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={research}
                      className="ai-menu-item"
                      onClick={() => onResearch(!research)}
                      title="Research — search the live web and cross-check multiple sources"
                    >
                      <BookIcon className="w-4 h-4 ai-t3" /> <span className="flex-1">Research</span>
                      {research && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                    </button>
                    {IMAGES_ENABLED && (
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={imageMode}
                        className="ai-menu-item"
                        onClick={() => onImageMode(!imageMode)}
                        title="Create an image from your next message"
                      >
                        <span className="w-4 text-center" aria-hidden>
                          ✦
                        </span>
                        <span className="flex-1">Create an image</span>
                        {imageMode && <CheckIcon className="w-3.5 h-3.5 text-ember-400" />}
                      </button>
                    )}
                    <div className="ai-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
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

            <button
              type="button"
              onClick={() => {
                if (!agentBlocked) onToggleAgent();
              }}
              aria-pressed={agentOn}
              aria-disabled={agentBlocked || undefined}
              aria-busy={agentAvailability === 'loading' || undefined}
              aria-label="Agent mode"
              aria-describedby={agentHintId}
              title={
                agentBlocked
                  ? 'No agent model is available right now'
                  : 'Agent mode — the assistant can search the web and run code by itself'
              }
              className={cn('ai-chip ai-agent-toggle', agentOn && 'ai-chip-on', agentBlocked && 'ai-chip-blocked')}
            >
              <AgentIcon className={cn('w-4 h-4', agentAvailability === 'loading' && 'ai-pulse')} />
              <span className="hidden sm:inline">Agent</span>
            </button>
            <span id={agentHintId} className="sr-only">
              {agentBlocked
                ? 'No agent model is available right now.'
                : 'When on, the assistant uses an agent-capable model that can search the web and run code by itself.'}
            </span>

            {activeTools.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed="true"
                title={`${t} is on — tap to turn it off`}
                onClick={() => (t === 'Think' ? onThink(false) : t === 'Research' ? onResearch(false) : onWeb(false))}
                className="ai-chip ai-chip-solid ai-from-sm"
              >
                {t}
                <XIcon className="w-3 h-3 opacity-70" />
              </button>
            ))}

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
            {canSpeech && (
              <button
                type="button"
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                aria-label="Voice input"
                aria-pressed={dictation.listening}
                title="Speak"
                className={cn('ai-icon-btn ai-round', dictation.listening && 'ai-icon-btn-on ai-pulse')}
              >
                <MicIcon className="w-[18px] h-[18px]" />
              </button>
            )}
            {busy ? (
              <button type="button" onClick={onStop} aria-label="Stop" title="Stop (Esc)" className="ai-send ai-send-stop">
                <StopIcon className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={() => submit(text)} disabled={!text.trim() && pending.length === 0} aria-label="Send" title="Send" className="ai-send">
                <SendIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <p className="ai-composer-status" role={dictation.note ? 'status' : undefined}>
          {dictation.note ? (
            <span className="text-amber-500 dark:text-amber-400">{dictation.note}</span>
          ) : busy && think ? (
            <span className="text-ember-400">thinking deeply…</span>
          ) : activeTools.length || agentOn ? (
            <span className="text-ember-400">{[agentOn && 'Agent', ...activeTools].filter(Boolean).join(' · ')} on</span>
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
