/**
 * VinaX AI — its own settings, in a panel that slides over the chat (the
 * sidebar's Settings, the header's gear, or Settings in the + menu). All of
 * it is kept on this device (prefs.ts), except the theme, which is the app's:
 *
 *   General          the app's theme, artifacts, live previews in replies
 *   Personalisation  what VinaX AI calls you, about you, how to reply, a
 *                    reply style (sent with each message, never stored)
 *   Memory  what VinaX AI remembers across chats, kept with the account:
 *           Use memory, Learn from my chats, each note, add, forget all
 *   Chat    the model new messages use, Extended thinking, Web search
 *   Voice   the microphone (with a test meter), the Read aloud voice, the
 *           Live voice, the Live model and web search in Live voice
 *   Chats   export every chat; the artifacts gallery; the shared links (open, copy, stop sharing);
 *           a link to the rest of VinaX's settings
 *
 * The app's own Settings page stays for everything that is not VinaX AI.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { toast } from '@/store/toastStore';
import { useSettingsStore } from '@/store/settingsStore';
import { cleanMicLabel, closeMic, listMics, micLabelOf, MicError, micNotice, newAudioContext, openMic, silentMicNotice, watchMic, type MicDevice } from './mic';
import { PERSONAL_MAX, usePrefs, type ReplyStyle } from './prefs';
import { voiceLabel } from './live/liveOptions';
import { SharedLinks } from './SharedLinks';
import { MemorySettings } from './MemorySettings';
import { ArtifactsIcon, CloseIcon, DownloadIcon, MicIcon } from './icons';
import type { PickerModel, VoiceInfo } from './types';
import type { WebSearch } from './PlusMenu';

export type SettingsSection = 'general' | 'personal' | 'memory' | 'chat' | 'voice' | 'chats';

const THEMES: Array<{ value: 'dark' | 'amoled' | 'light' | 'system' | 'auto'; label: string }> = [
  { value: 'system', label: 'System: follow this device' },
  { value: 'dark', label: 'Dark' },
  { value: 'amoled', label: 'Black' },
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Auto: light by day, dark at night' },
];
const STYLES: Array<{ value: ReplyStyle; label: string }> = [
  { value: 'normal', label: 'Normal: VinaX AI’s usual replies' },
  { value: 'concise', label: 'Concise: shorter, to the point' },
  { value: 'explanatory', label: 'Explanatory: teaches the why, with examples' },
  { value: 'formal', label: 'Formal: clear and professional' },
  { value: 'learning', label: 'Learning: guides you to work it out' },
];

const GROUP_LABEL: Record<string, string> = {
  fast: 'Fast', balanced: 'Balanced', smart: 'Smart', vision: 'Vision', code: 'Code', cloudflare: 'Cloudflare', more: 'More models',
  'more-groq': 'More from Groq', 'more-gemini': 'More from Gemini', 'more-openrouter': 'More from OpenRouter',
  'more-nvidia': 'More from NVIDIA', 'more-cloudflare': 'More from Cloudflare',
};
const SEARCH: Array<{ value: WebSearch; label: string }> = [
  { value: 'auto', label: 'Auto: when you ask about something current' },
  { value: 'on', label: 'On: search for every message' },
  { value: 'off', label: 'Off: never search' },
];
const cap = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

interface Props {
  models: PickerModel[];
  groups: string[];
  voice: VoiceInfo | undefined;
  /** Web search is offered. */
  search: boolean;
  /** Open scrolled to this section. */
  section?: SettingsSection;
  onClose(): void;
}

export function SettingsPanel({ models, groups, voice, search, section, onClose }: Props): ReactNode {
  const prefs = usePrefs();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const box = useRef<HTMLDivElement>(null);
  useDismissOnBack(true, onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const target = section ? box.current?.querySelector<HTMLElement>(`#vx-ai-set-${section}`) : null;
    target?.scrollIntoView({ block: 'start' });
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => back?.focus?.();
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupOrder = [...groups, ...models.map((m) => m.group).filter((g) => !groups.includes(g))].filter((g, i, a) => a.indexOf(g) === i);
  const modelOk = prefs.model === 'auto' || models.some((m) => m.id === prefs.model);
  const read = voice?.voices.includes(prefs.voice) ? prefs.voice : voice?.voices[0];
  const live = voice?.liveVoices.includes(prefs.liveVoice) ? prefs.liveVoice : voice?.liveVoices[0];
  const liveModels = voice?.liveModels ?? [];
  const liveModel = liveModels.some((m) => m.id === prefs.liveModel) ? prefs.liveModel : 'auto';
  const hasVoice = !!voice && (voice.dictation || voice.readAloud || voice.live);

  return (
    <div className="vx-ai-scrim vx-ai-settings-scrim" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vx-ai-settings-title"
        className="vx-ai-settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Tab') {
            const f = [...(box.current?.querySelectorAll<HTMLElement>('select:not([disabled]), button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])') ?? [])];
            const i = f.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
          }
        }}
      >
        <header className="vx-ai-settings-head">
          <h2 id="vx-ai-settings-title">VinaX AI settings</h2>
          <button type="button" className="vx-ai-icon-btn" onClick={onClose} aria-label="Close settings">
            <CloseIcon className="w-5 h-5" />
          </button>
        </header>
        <nav className="vx-ai-settings-nav" aria-label="Settings sections">
          {([['general', 'General'], ['personal', 'Personalisation'], ['memory', 'Memory'], ['chat', 'Chat'], ...(hasVoice ? [['voice', 'Voice']] : []), ['chats', 'Your chats']] as Array<[SettingsSection, string]>).map(([id, label]) => (
            <button key={id} type="button" className="vx-ai-chip" onClick={() => box.current?.querySelector<HTMLElement>(`#vx-ai-set-${id}`)?.scrollIntoView({ block: 'start' })}>{label}</button>
          ))}
        </nav>
        <div className="vx-ai-settings-body">
          <section id="vx-ai-set-general" aria-labelledby="vx-ai-set-general-h">
            <h3 id="vx-ai-set-general-h">General</h3>
            <Field id="theme" label="Appearance" hint="The same theme as the rest of VinaX.">
              <select id="vx-ai-set-theme" aria-describedby="vx-ai-set-theme-hint" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Switch on={prefs.artifacts} label="Artifacts" sub="Whole files, pages, charts and diagrams open in their own panel" onToggle={() => prefs.set({ artifacts: !prefs.artifacts })} />
            <Switch on={prefs.inlinePreviews && prefs.artifacts} disabled={!prefs.artifacts} label="Live previews in replies" sub="Shows pages, charts and diagrams right in the chat" onToggle={() => prefs.set({ inlinePreviews: !prefs.inlinePreviews })} />
          </section>

          <section id="vx-ai-set-personal" aria-labelledby="vx-ai-set-personal-h">
            <h3 id="vx-ai-set-personal-h">Personalisation</h3>
            <Field id="pname" label="What should VinaX AI call you?">
              <input id="vx-ai-set-pname" type="text" autoComplete="nickname" maxLength={PERSONAL_MAX.name} value={prefs.personalName} placeholder="Your first name" onChange={(e) => prefs.set({ personalName: e.target.value })} />
            </Field>
            <Field id="pabout" label="What should VinaX AI know about you?" hint="Your work, interests, what you’re learning. Used in every chat.">
              <textarea id="vx-ai-set-pabout" aria-describedby="vx-ai-set-pabout-hint" rows={3} maxLength={PERSONAL_MAX.about} value={prefs.personalAbout} placeholder="I’m a music student who loves Carnatic and lo-fi…" onChange={(e) => prefs.set({ personalAbout: e.target.value })} />
            </Field>
            <Field id="pinstr" label="How should VinaX AI reply?" hint="Tone, length, format, language. It still won’t break its safety rules.">
              <textarea id="vx-ai-set-pinstr" aria-describedby="vx-ai-set-pinstr-hint" rows={3} maxLength={PERSONAL_MAX.instructions} value={prefs.personalInstructions} placeholder="Be brief. Use tables for comparisons. Reply in Telugu when I write in Telugu…" onChange={(e) => prefs.set({ personalInstructions: e.target.value })} />
            </Field>
            <Field id="style" label="Reply style">
              <select id="vx-ai-set-style" value={prefs.style} onChange={(e) => prefs.set({ style: e.target.value as ReplyStyle })}>
                {STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <p className="vx-ai-settings-note">Kept on this device and sent with each message so the reply can use it. It isn’t saved with your chats.</p>
          </section>

          <section id="vx-ai-set-memory" aria-labelledby="vx-ai-set-memory-h">
            <h3 id="vx-ai-set-memory-h">Memory</h3>
            <MemorySettings />
          </section>

          <section id="vx-ai-set-chat" aria-labelledby="vx-ai-set-chat-h">
            <h3 id="vx-ai-set-chat-h">Chat</h3>
            <Field id="model" label="Model" hint="The same choice as the model menu under the message box.">
              <select id="vx-ai-set-model" aria-describedby="vx-ai-set-model-hint" value={modelOk ? prefs.model : 'auto'} onChange={(e) => prefs.set({ model: e.target.value })}>
                <option value="auto">Auto: picks the best model for each message</option>
                {groupOrder.map((g) => {
                  const list = models.filter((m) => m.group === g);
                  if (!list.length) return null;
                  return (
                    <optgroup key={g} label={GROUP_LABEL[g] ?? cap(g)}>
                      {list.map((m) => (
                        <option key={m.id} value={m.id} disabled={!m.available}>
                          {m.name} · {m.provider}{m.available ? '' : m.reason === 'busy' ? ' (busy)' : ' (unavailable)'}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </Field>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.extendedThinking}
              className="vx-ai-setting-switch"
              onClick={() => prefs.set({ extendedThinking: !prefs.extendedThinking })}
            >
              <span className="vx-ai-menu-text">
                <span>Extended thinking</span>
                <span className="vx-ai-opt-sub">Thinks longer before answering hard questions</span>
              </span>
              <span className={`vx-ai-switch${prefs.extendedThinking ? ' is-on' : ''}`} aria-hidden />
            </button>
            {search && (
              <Field id="search" label="Web search">
                <select id="vx-ai-set-search" value={prefs.webSearch} onChange={(e) => prefs.set({ webSearch: e.target.value as WebSearch })}>
                  {SEARCH.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            )}
          </section>

          {hasVoice && voice && (
            <section id="vx-ai-set-voice" aria-labelledby="vx-ai-set-voice-h">
              <h3 id="vx-ai-set-voice-h">Voice</h3>
              {(voice.dictation || voice.live) && <MicSetting />}
              {voice.readAloud && read && (
                <Field id="read" label="Read aloud voice">
                  <select id="vx-ai-set-read" value={read} onChange={(e) => prefs.set({ voice: e.target.value })}>
                    {voice.voices.map((v) => <option key={v} value={v}>{cap(v)}</option>)}
                  </select>
                </Field>
              )}
              {(voice.live || voice.readAloud) && live && (
                <Field id="live" label="Live voice" hint="Also reads long replies aloud.">
                  <select id="vx-ai-set-live" aria-describedby="vx-ai-set-live-hint" value={live} onChange={(e) => prefs.set({ liveVoice: e.target.value })}>
                    {voice.liveVoices.map((v) => <option key={v} value={v}>{voiceLabel(v)}</option>)}
                  </select>
                </Field>
              )}
              {voice.live && (voice.liveLanguages?.length ?? 0) > 0 && (
                <Field id="livelang" label="Live voice language" hint="Live voice replies in this language and doesn’t switch unless you ask.">
                  <select id="vx-ai-set-livelang" aria-describedby="vx-ai-set-livelang-hint" value={voice.liveLanguages!.some((l) => l.code === prefs.liveLanguage) ? prefs.liveLanguage : 'auto'} onChange={(e) => prefs.set({ liveLanguage: e.target.value })}>
                    <option value="auto">Match how I speak</option>
                    {voice.liveLanguages!.map((l) => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.name} · ${l.native}`}</option>)}
                  </select>
                </Field>
              )}
              {voice.live && liveModels.length > 0 && (
                <Field id="livemodel" label="Live voice model" hint="If it can’t connect, Live voice uses the next one.">
                  <select id="vx-ai-set-livemodel" aria-describedby="vx-ai-set-livemodel-hint" value={liveModel} onChange={(e) => prefs.set({ liveModel: e.target.value })}>
                    <option value="auto">Auto: the best one that’s free right now</option>
                    {liveModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
              )}
              {voice.live && voice.liveSearch && (
                <button
                  type="button"
                  role="switch"
                  id="vx-ai-set-livesearch"
                  aria-checked={prefs.liveSearch}
                  className="vx-ai-setting-switch"
                  onClick={() => prefs.set({ liveSearch: !prefs.liveSearch })}
                >
                  <span className="vx-ai-menu-text">
                    <span>Search the web in Live voice</span>
                    <span className="vx-ai-opt-sub">Looks up news and current facts while you talk</span>
                  </span>
                  <span className={`vx-ai-switch${prefs.liveSearch ? ' is-on' : ''}`} aria-hidden />
                </button>
              )}
            </section>
          )}

          <section id="vx-ai-set-chats" aria-labelledby="vx-ai-set-chats-h">
            <h3 id="vx-ai-set-chats-h">Your chats</h3>
            <button
              type="button"
              className="vx-ai-chip"
              onClick={() => {
                void import('./exportChats')
                  .then((m) => m.downloadAiChats())
                  .then(() => toast('VinaX AI chats downloaded'))
                  .catch(() => toast('Couldn’t download your chats. Try again.'));
              }}
            >
              <DownloadIcon className="w-4 h-4" /> Export all chats
            </button>
            <p className="vx-ai-settings-note">A JSON file of every chat, with all its versions. Your chats stay with your account.</p>
            <Link to="/vinaxai/artifacts" className="vx-ai-chip vx-ai-gallery-link" onClick={onClose}>
              <ArtifactsIcon className="w-4 h-4" /> Your artifacts
            </Link>
            <p className="vx-ai-settings-note">Every page, component, diagram, image, document and piece of code your chats made, in one place.</p>
            <SharedLinks onNavigate={onClose} />
            <p className="vx-ai-settings-note">These settings are kept on this device. <Link to="/settings" onClick={onClose}>VinaX settings</Link> has everything else.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** An on/off setting. */
function Switch({ on, label, sub, disabled, onToggle }: { on: boolean; label: string; sub: string; disabled?: boolean; onToggle(): void }): ReactNode {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className="vx-ai-setting-switch" onClick={onToggle}>
      <span className="vx-ai-menu-text">
        <span>{label}</span>
        <span className="vx-ai-opt-sub">{sub}</span>
      </span>
      <span className={`vx-ai-switch${on ? ' is-on' : ''}`} aria-hidden />
    </button>
  );
}

/** A labelled setting; the hint is the control's description, not part of its name. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="vx-ai-field">
      <label htmlFor={`vx-ai-set-${id}`}>{label}</label>
      {children}
      {hint && <small id={`vx-ai-set-${id}-hint`}>{hint}</small>}
    </div>
  );
}

/** The microphone: Automatic or a device, and a test that shows what the mic hears. */
function MicSetting(): ReactNode {
  const micId = usePrefs((s) => s.micId);
  const set = usePrefs((s) => s.set);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [test, setTest] = useState<{ level: number; label: string; heard: boolean; secs: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stopTest = useRef<() => void>(() => undefined);

  useEffect(() => {
    void listMics().then(setMics);
    const md = navigator.mediaDevices;
    const changed = () => void listMics().then(setMics);
    md?.addEventListener?.('devicechange', changed);
    return () => {
      md?.removeEventListener?.('devicechange', changed);
      stopTest.current();
    };
  }, []);

  const named = mics.some((m) => m.label);
  const choices = mics.filter((m) => m.deviceId !== 'default' && m.deviceId !== 'communications');
  const known = !micId || choices.some((m) => m.deviceId === micId);

  const runTest = async () => {
    if (test) { stopTest.current(); return; }
    setNote(null);
    // Made inside the tap, so the meter runs on every browser.
    const ctx = newAudioContext();
    let stream: MediaStream;
    try {
      stream = await openMic(micId);
    } catch (e) {
      void ctx?.close().catch(() => undefined);
      setNote(micNotice(e instanceof MicError ? e.problem : 'unsupported'));
      return;
    }
    setMics(await listMics());
    const watch = watchMic(stream, ctx);
    const label = micLabelOf(stream);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      setTest({ level: watch.level(), label, heard: watch.heard(), secs });
      if (secs >= 10) stopTest.current();
    }, 80);
    stopTest.current = () => {
      window.clearInterval(timer);
      const heard = watch.heard();
      watch.stop();
      closeMic(stream);
      void ctx?.close().catch(() => undefined);
      setTest(null);
      setNote(heard ? `“${label || 'Your microphone'}” works.` : silentMicNotice(label, 'Pick another one above.'));
      stopTest.current = () => undefined;
    };
  };

  return (
    <div className="vx-ai-field">
      <label htmlFor="vx-ai-mic">Microphone</label>
      <select
        id="vx-ai-mic"
        value={known ? micId : ''}
        onChange={(e) => { stopTest.current(); setNote(null); set({ micId: e.target.value }); }}
      >
        <option value="">Automatic (skips silent virtual devices)</option>
        {choices.map((m, i) => (
          <option key={m.deviceId} value={m.deviceId}>
            {cleanMicLabel(m.label) || `Microphone ${i + 1}`}{m.virtual ? ' (virtual)' : ''}
          </option>
        ))}
      </select>
      {!named && <small>Test the mic once to see your microphones by name.</small>}
      <div className="vx-ai-mic-test">
        <button type="button" className="vx-ai-chip" onClick={() => void runTest()} aria-pressed={!!test}>
          <MicIcon className="w-4 h-4" /> {test ? 'Stop test' : 'Test microphone'}
        </button>
        {test && (
          <span className="vx-ai-mic-live" role="status" aria-label={test.heard ? 'Hearing sound' : 'No sound yet'}>
            <span className="vx-ai-mic-bar" aria-hidden><i style={{ width: `${Math.round(test.level * 100)}%` }} /></span>
            <span className="vx-ai-mic-name">{test.label || 'Microphone'}</span>
          </span>
        )}
      </div>
      {test && !test.heard && test.secs >= 2 && <small role="alert">{silentMicNotice(test.label, 'Pick another one above.')}</small>}
      {note && !test && <small role="status">{note}</small>}
    </div>
  );
}
