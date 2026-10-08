import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Sheet } from '@/components/Sheet';
import { DownloadIcon, XIcon } from '@/components/Icons';
import { ReplyPrefsBar } from '@/components/ai/AiExtras';
import { useCurrentSong } from '@/store/playerStore';
import { cn } from '@/utils/cn';
import { ChatStyleMark, ChatStyleSetting } from './ChatStyleScope';
import { ModelMenu } from './ModelMenu';
import { TrashIcon, UploadIcon } from './icons';
import { choiceLabel, choiceProvider, mediaGroups, type CatalogState } from './models';
import { ProviderLogo } from './ProviderLogo';
import { formatBytes, storageUsedBytes } from './storage';
import type { ModelChoice, Provider } from './types';
import type { DictationChoice } from './media';
import { MemorySection } from './MemorySection';
import { recorderSupported } from './useServerDictation';
import { MicPicker } from './MicPicker';
import { type VoiceCatalog } from './voices';
import { onRadioKeys, VoicePicker } from './VoicePicker';
import { DEVICE_VOICE, parseVoicePick } from '../voicePick';

export { DEVICE_VOICE };
export type { VoiceCatalog };

/**
 * 10.3 — a list of choices as one radio group: arrow keys move and choose,
 * like a native radio set; each option is a 44px row or chip.
 */

export type SettingsTab = 'general' | 'replies' | 'voice' | 'data' | 'shortcuts';
const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'replies', label: 'Replies' },
  { id: 'voice', label: 'Voice' },
  { id: 'data', label: 'Data' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

export interface SettingsDialogProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  // General
  fontSize: 's' | 'm' | 'l';
  onFontSize: (f: 's' | 'm' | 'l') => void;
  /** The explicit default (Auto or one exact model), or null = start on the
   *  last model used. 10.3 — the same Auto / provider / model choice as the
   *  composer's menu. */
  defaultChoice: ModelChoice | null;
  onDefaultChoice: (c: ModelChoice | null) => void;
  catalogState: CatalogState;
  catalogProviders: Provider[];
  onLoadCatalog: () => void;
  recents: ModelChoice[];
  sendOnEnter: boolean;
  onSendOnEnter: (on: boolean) => void;
  // Replies
  replyLang: string;
  replyStyle: string;
  songCtx: boolean;
  onReplyLang: (v: string) => void;
  onReplyStyle: (v: string) => void;
  onSongCtx: (v: boolean) => void;
  profile: string;
  onProfile: (v: string) => void;
  // Voice
  voicePick: string;
  onVoicePick: (v: string) => void;
  voiceCatalog: VoiceCatalog | null;
  autoRead: boolean;
  onAutoRead: (on: boolean) => void;
  /** 10.3 — the composer mic's engine: a server transcription model, or null
   *  for this device's dictation (the default). */
  /** 11.3.1 — Auto (null, the default), this device ('device'), or one model. */
  dictationPick: DictationChoice;
  onDictationPick: (pick: DictationChoice) => void;
  // Data
  chatCount: number;
  onExportAll: () => void;
  /** Resolves to a line describing what happened. */
  onImport: (fileText: string) => string;
  onClearAll: () => void;
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string }): ReactNode {
  const id = useId();
  return (
    <div className="ai-set-row">
      <span className="min-w-0">
        <span id={`${id}-l`} className="block text-[14px] font-semibold ai-t1">
          {label}
        </span>
        {hint && (
          <span id={`${id}-h`} className="block text-[13px] ai-t3 leading-snug mt-0.5">
            {hint}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        onClick={() => onChange(!checked)}
        className="ai-switch"
      >
        <span className="ai-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['Ctrl/⌘', 'K'], what: 'New chat' },
  { keys: ['Ctrl/⌘', 'B'], what: 'Show or hide the chat list' },
  { keys: ['Esc'], what: 'Stop the reply · close a menu' },
  { keys: ['Enter'], what: 'Send (when “Send with Enter” is on)' },
  { keys: ['Shift', 'Enter'], what: 'New line' },
  { keys: ['Ctrl/⌘', 'Enter'], what: 'Send, always' },
  { keys: ['/'], what: 'Open the command menu in the message box' },
  { keys: ['Tab'], what: 'Complete the first matching command' },
  { keys: ['↑', '↓'], what: 'Move through the model menu' },
  { keys: ['Home', 'End'], what: 'First / last model in the menu' },
  { keys: ['Enter'], what: 'Choose the highlighted model' },
  { keys: ['←', '→'], what: 'Move between settings tabs' },
  { keys: ['Double-click'], what: 'Edit & resend one of your messages · rename a chat' },
];

/**
 * v7.1 — chat settings as a real modal dialog (it replaces the small gear
 * popover). Built on the shared Sheet, so focus trap, Escape, hardware back
 * and scroll lock come with it. A tab rail on the left from `sm` up, tabs
 * along the top on a phone. Every setting the popover had is here, on the
 * same persisted key.
 */
export function SettingsDialog(p: SettingsDialogProps): ReactNode {
  const [tab, setTab] = useState<SettingsTab>(p.initialTab ?? 'general');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const defaultProvider = choiceProvider(p.defaultChoice);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importNote, setImportNote] = useState('');
  const [used, setUsed] = useState(0);
  const uid = useId();
  const titleId = `${uid}-title`;
  const importRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const song = useCurrentSong();

  useEffect(() => {
    if (tab === 'data') setUsed(storageUsedBytes());
  }, [tab, p.chatCount]);
  // 10.3 — the Voice tab lists the dictation models from the model list.
  const { onLoadCatalog } = p;
  useEffect(() => {
    if (tab === 'voice') onLoadCatalog();
  }, [tab, onLoadCatalog]);

  const vertical = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches;

  const onTabKey = (e: KeyboardEvent): void => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  // 10.3 — the saved voice, in the provider|model|voice shape (an older
  // build's model|voice was migrated when the page read it).
  const picked = parseVoicePick(p.voicePick);
  const voiceProviders = p.voiceCatalog?.providers ?? [];
  const pickListed =
    !picked || voiceProviders.some((vp) => vp.id === picked.provider && vp.models.some((m) => m.id === picked.model && m.voices.includes(picked.voice)));
  const voiceNote =
    p.voiceCatalog === null
      ? 'Checking which voices are available…'
      : !pickListed
        ? 'The voice you chose isn’t available right now — replies are spoken by this device until it is back.'
        : voiceProviders.length
          ? 'Used for live voice chat and for Read aloud on a reply. Falls back to this device if a voice is briefly unavailable.'
          : p.voiceCatalog.configured
            ? 'No studio voice is available right now — replies are spoken by this device.'
            : 'Studio voices aren’t configured — replies are spoken by this device.';
  const dictationGroups = mediaGroups(p.catalogProviders, 'transcription');
  const canRecord = recorderSupported();
  // 11.3.1 — Auto is the default and what this browser falls to when it
  // cannot record (then the mic uses this device anyway).
  const dictationKey = p.dictationPick === 'device' ? DEVICE_VOICE : p.dictationPick ? `${p.dictationPick.provider}|${p.dictationPick.model}` : 'auto';
  const dictationListed = dictationKey === 'auto' || dictationKey === DEVICE_VOICE || (canRecord && dictationGroups.some((g) => g.models.some((m) => `${g.provider}|${m.id}` === dictationKey)));
  const dictationNote = !canRecord
    ? 'This browser can’t record — the mic and voice chat use this device’s speech recognition.'
    : dictationKey === DEVICE_VOICE
      ? 'The mic and voice chat use this browser’s own speech recognition. If it hears you but writes nothing, choose Auto.'
      : 'The mic records until you tap it again, then turns it into text; voice chat sends each thing you say the same way. If that fails, this device’s recognition takes over.';

  return (
    <Sheet
      // Escape / back / a backdrop click close the open model menu first.
      onClose={() => (modelMenuOpen ? setModelMenuOpen(false) : p.onClose())}
      labelledBy={titleId}
      size="2xl"
      layout="column"
      maxHeight="medium"
      className="ai-scope ai-settings"
    >
      <div className="flex items-center gap-3 pb-3">
        <h2 id={titleId} className="ai-settings-title flex-1 ai-t1">
          Chat settings
        </h2>
        <ChatStyleMark />
        <button type="button" onClick={p.onClose} aria-label="Close settings" className="ai-icon-btn ai-settings-close">
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="ai-settings-body">
        <div role="tablist" aria-label="Settings sections" aria-orientation={vertical ? 'vertical' : 'horizontal'} className="ai-tablist" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${uid}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className="ai-tab"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${uid}-panel-${tab}`} aria-labelledby={`${uid}-tab-${tab}`} tabIndex={0} className="ai-tabpanel">
          {tab === 'general' && (
            <>
              <ChatStyleSetting />
              <div className="ai-set-row">
                <span className="text-[14px] font-semibold ai-t1">Text size</span>
                <span className="flex gap-1" role="group" aria-label="Text size">
                  {(['s', 'm', 'l'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => p.onFontSize(f)}
                      aria-pressed={p.fontSize === f}
                      aria-label={f === 's' ? 'Small' : f === 'm' ? 'Medium' : 'Large'}
                      className={cn('ai-chip px-2.5 py-1', p.fontSize === f && 'ai-chip-solid')}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </span>
              </div>
              <div className="ai-set-block">
                <div className="ai-set-row">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold ai-t1">Default model</span>
                    <span className="block text-[13px] ai-t3 leading-snug mt-0.5">
                      {p.defaultChoice ? 'Every visit starts on this model.' : 'Every visit starts on the model you used last.'}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    aria-label={`Default model: ${p.defaultChoice ? choiceLabel(p.defaultChoice, p.catalogProviders) : 'Last used'}`}
                    onClick={() => {
                      setModelMenuOpen((v) => !v);
                      p.onLoadCatalog();
                    }}
                    className={cn('ai-chip ai-model-pick max-w-[12rem]', modelMenuOpen && 'ai-chip-on')}
                  >
                    {defaultProvider && <ProviderLogo provider={defaultProvider} size={16} />}
                    <span className="truncate">{p.defaultChoice ? choiceLabel(p.defaultChoice, p.catalogProviders) : 'Last used'}</span>
                  </button>
                </div>
                {modelMenuOpen && (
                  <ModelMenu
                    className="ai-model-menu-inline"
                    state={p.catalogState}
                    providers={p.catalogProviders}
                    current={p.defaultChoice}
                    recents={p.recents}
                    onPick={(c) => {
                      p.onDefaultChoice(c);
                      setModelMenuOpen(false);
                    }}
                    onClose={() => setModelMenuOpen(false)}
                    onRetry={p.onLoadCatalog}
                  />
                )}
                {p.defaultChoice && !modelMenuOpen && (
                  <button type="button" onClick={() => p.onDefaultChoice(null)} className="ai-tool -ml-1.5">
                    Start on the last model used instead
                  </button>
                )}
              </div>
              <Switch
                checked={p.sendOnEnter}
                onChange={p.onSendOnEnter}
                label="Send with Enter"
                hint="Off: Enter starts a new line and Ctrl/⌘+Enter sends."
              />
            </>
          )}

          {tab === 'replies' && (
            <>
              <ReplyPrefsBar
                lang={p.replyLang}
                style={p.replyStyle}
                songCtx={p.songCtx}
                hasSong={!!song}
                onLang={p.onReplyLang}
                onStyle={p.onReplyStyle}
                onSongCtx={p.onSongCtx}
              />
              <div className="ai-set-block">
                <label htmlFor={`${uid}-about`} className="block text-[14px] font-semibold ai-t1">
                  About you
                </label>
                <p className="text-[13px] ai-t3 leading-snug mt-0.5 mb-2">Stays on this device and is sent with each message so replies fit you.</p>
                <textarea
                  id={`${uid}-about`}
                  value={p.profile}
                  onChange={(e) => p.onProfile(e.target.value.slice(0, 1500))}
                  rows={4}
                  placeholder="Name, what you do, languages you prefer, how you like answers…"
                  className="ai-field w-full px-2.5 py-2 text-[13px] outline-none resize-none ai-t1 placeholder:opacity-55"
                />
                <p className="text-[11px] ai-t3 text-right mt-0.5" aria-hidden>
                  {p.profile.length} / 1500
                </p>
              </div>
              {/* 9.1.0 — opt-in memory: lines the listener writes, which they can
                  edit or remove here, and which are sent with every chat. */}
              <MemorySection id={`${uid}-mem`} />
            </>
          )}

          {tab === 'voice' && (
            <>
              <div className="ai-set-block">
                <p id={`${uid}-voice`} className="block text-[14px] font-semibold ai-t1 mb-1.5">
                  Spoken reply voice
                </p>
                {/* 10.3 — this device's voice, then every voice of every speech
                    model, grouped by provider. Nothing is listed unless the
                    server serves it. 11.2 — every voice has its own preview. */}
                <VoicePicker catalog={p.voiceCatalog} value={p.voicePick} onChange={p.onVoicePick} labelledBy={`${uid}-voice`} />
                <p className="mt-1.5 text-[13px] ai-t3 leading-snug">{voiceNote}</p>
              </div>
              <Switch
                checked={p.autoRead}
                onChange={p.onAutoRead}
                label="Read replies aloud automatically"
                hint="Each finished reply is spoken in the voice above. Tap the speaker on a reply to stop."
              />
              {/* 11.3.2 — which microphone records. */}
              <MicPicker />
              {/* 10.3 — what the composer's mic uses. 11.3.1 — and what live
                  voice chat listens with. */}
              <div className="ai-set-block">
                <p id={`${uid}-dict`} className="block text-[14px] font-semibold ai-t1 mb-1.5">
                  Dictation
                </p>
                <div role="radiogroup" aria-labelledby={`${uid}-dict`} className="ai-voice-list" onKeyDown={onRadioKeys}>
                  {canRecord && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={dictationKey === 'auto'}
                      tabIndex={dictationKey === 'auto' || !dictationListed ? 0 : -1}
                      className="ai-voice-row"
                      onClick={() => p.onDictationPick(null)}
                    >
                      <span className="ai-voice-radio" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold ai-t1">Auto</span>
                        <span className="block text-[12px] ai-t3">Default · the best available speech-to-text model</span>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={dictationKey === DEVICE_VOICE || (!canRecord && dictationKey === 'auto')}
                    tabIndex={dictationKey === DEVICE_VOICE || (!canRecord && dictationKey === 'auto') ? 0 : -1}
                    className="ai-voice-row"
                    onClick={() => p.onDictationPick('device')}
                  >
                    <span className="ai-voice-radio" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold ai-t1">This device</span>
                      <span className="block text-[12px] ai-t3">The browser’s own recognition · words appear as you speak</span>
                    </span>
                  </button>
                  {canRecord &&
                    dictationGroups.map((g) => (
                      <div key={g.provider} role="group" aria-labelledby={`${uid}-dp-${g.provider}`} className="ai-voice-provider">
                        <p className="ai-voice-heading">
                          <ProviderLogo provider={g.provider} size={16} />
                          <span id={`${uid}-dp-${g.provider}`}>{g.label}</span>
                        </p>
                        {g.models.map((m) => {
                          const key = `${g.provider}|${m.id}`;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              role="radio"
                              aria-checked={dictationKey === key}
                              tabIndex={dictationKey === key ? 0 : -1}
                              className="ai-voice-row"
                              onClick={() => p.onDictationPick({ provider: g.provider, model: m.id, name: m.name })}
                            >
                              <span className="ai-voice-radio" aria-hidden />
                              <span className="min-w-0">
                                <span className="block text-[14px] font-semibold ai-t1 truncate">{m.name}</span>
                                {m.maker && <span className="block text-[12px] ai-t3 truncate">{m.maker}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                </div>
                <p className="mt-1.5 text-[13px] ai-t3 leading-snug">{dictationNote}</p>
              </div>
            </>
          )}

          {tab === 'data' && (
            <>
              <div className="ai-set-row">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold ai-t1">Storage used</span>
                  <span className="block text-[13px] ai-t3 leading-snug mt-0.5">
                    {p.chatCount} chat{p.chatCount === 1 ? '' : 's'} kept on this device only. Attached images are never stored.
                  </span>
                </span>
                <span className="text-[13px] font-bold ai-t1 shrink-0">{formatBytes(used)}</span>
              </div>
              <div className="ai-set-block flex flex-wrap gap-2">
                <button type="button" onClick={p.onExportAll} className="ai-btn">
                  <DownloadIcon className="w-4 h-4" /> Export all chats (.json)
                </button>
                <button type="button" onClick={() => importRef.current?.click()} className="ai-btn">
                  <UploadIcon className="w-4 h-4" /> Import chats
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label="Import chats file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > 20_000_000) {
                      setImportNote('That file is too large to import.');
                      return;
                    }
                    void file.text().then(
                      (text) => setImportNote(p.onImport(text)),
                      () => setImportNote('That file could not be read.'),
                    );
                  }}
                />
              </div>
              {importNote && (
                <p className="text-[12px] ai-t2" role="status">
                  {importNote}
                </p>
              )}
              <div className="ai-set-block">
                {confirmClear ? (
                  <div className="ai-confirm" role="alertdialog" aria-label="Delete all chats?">
                    <p className="text-[13px] font-semibold ai-t1">
                      Delete all {p.chatCount} chat{p.chatCount === 1 ? '' : 's'} stored on this device?
                    </p>
                    <p className="text-[12px] ai-t3 mt-0.5">You can undo this for a few seconds afterwards.</p>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmClear(false);
                          p.onClearAll();
                        }}
                        className="ai-btn ai-btn-danger"
                      >
                        Delete all
                      </button>
                      <button type="button" autoFocus onClick={() => setConfirmClear(false)} className="ai-btn">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmClear(true)} className="ai-btn ai-btn-danger">
                    <TrashIcon className="w-4 h-4" /> Clear all chats
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'shortcuts' && (
            <dl className="ai-shortcuts">
              {SHORTCUTS.map((s) => (
                <div key={`${s.keys.join('+')}-${s.what}`} className="ai-shortcut">
                  <dt>
                    {s.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{s.what}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Sheet>
  );
}
