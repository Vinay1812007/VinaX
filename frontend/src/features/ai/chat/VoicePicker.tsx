import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { cn } from '@/utils/cn';
import { ChatStyleMark } from './ChatStyleScope';
import { ProviderLogo } from './ProviderLogo';
import { useVoicePreview, type VoicePreview } from './useVoicePreview';
import { voiceLabel, type VoiceCatalog } from './voices';
import { DEVICE_VOICE, formatVoicePick, parseVoicePick } from '../voicePick';

/** Arrow keys / Home / End move AND choose inside a radiogroup — only the
 *  radios take part; the preview buttons beside them are skipped. */
export function onRadioKeys(e: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !radios.length) return;
  e.preventDefault();
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (at + (fwd ? 1 : -1) + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

const PlayGlyph = (): ReactNode => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
  </svg>
);
const StopGlyph = (): ReactNode => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" fill="currentColor" />
  </svg>
);
const AlertGlyph = (): ReactNode => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M8 1.8 15 14H1L8 1.8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M8 6.2v3.6M8 11.6v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

function PreviewButton({ preview, vkey, name, tabIndex }: { preview: VoicePreview; vkey: string; name: string; tabIndex: number }): ReactNode {
  const mine = preview.active === vkey;
  const loading = mine && preview.status === 'loading';
  const playing = mine && preview.status === 'playing';
  const error = !mine ? preview.errors[vkey] : undefined;
  return (
    <button
      type="button"
      className={cn('ai-voice-preview', playing && 'is-playing', loading && 'is-loading', error && 'is-error')}
      aria-label={`Preview ${name}`}
      aria-pressed={playing || loading}
      aria-busy={loading}
      title={error ?? (playing ? `Stop ${name}` : `Preview ${name}`)}
      tabIndex={tabIndex}
      onClick={() => preview.toggle(vkey, name)}
    >
      {loading ? <span className="ai-voice-spin" aria-hidden /> : playing ? <StopGlyph /> : error ? <AlertGlyph /> : <PlayGlyph />}
    </button>
  );
}

/**
 * 11.2 — every voice the listener can choose, grouped by provider (logo +
 * name) → speech model (its real name) → voices, each with its own preview.
 * Used by Settings → Voice and by the picker inside voice chat; one choice
 * governs both live voice chat and Read aloud.
 */
export function VoicePicker({
  catalog,
  value,
  onChange,
  labelledBy,
}: {
  catalog: VoiceCatalog | null;
  value: string;
  onChange: (v: string) => void;
  labelledBy: string;
}): ReactNode {
  const uid = useId();
  const preview = useVoicePreview();
  const picked = parseVoicePick(value);
  const pickedKey = picked ? formatVoicePick(picked) : DEVICE_VOICE;
  const providers = catalog?.providers ?? [];
  const pickListed =
    !picked || providers.some((vp) => vp.id === picked.provider && vp.models.some((m) => m.id === picked.model && m.voices.includes(picked.voice)));
  const deviceTab = pickedKey === DEVICE_VOICE || !pickListed || !providers.length ? 0 : -1;
  // The latest failure, said once in words (the button shows it as a mark).
  const failedKey = Object.keys(preview.errors).pop();
  const failedName = failedKey ? (failedKey === DEVICE_VOICE ? 'Device voice' : voiceLabel(parseVoicePick(failedKey)?.voice ?? '')) : '';
  return (
    <>
      <div role="radiogroup" aria-labelledby={labelledBy} className="ai-voice-list" onKeyDown={onRadioKeys}>
        <div className="ai-voice-pick ai-voice-pick-row">
          <button
            type="button"
            role="radio"
            aria-checked={pickedKey === DEVICE_VOICE}
            tabIndex={deviceTab}
            className="ai-voice-row"
            onClick={() => onChange(DEVICE_VOICE)}
          >
            <span className="ai-voice-radio" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold ai-t1">Device voice</span>
              <span className="block text-[12px] ai-t3">Default · works offline</span>
            </span>
          </button>
          <PreviewButton preview={preview} vkey={DEVICE_VOICE} name="Device voice" tabIndex={deviceTab} />
        </div>
        {providers.map((vp) => (
          <div key={vp.id} role="group" aria-labelledby={`${uid}-vp-${vp.id}`} className="ai-voice-provider">
            <p className="ai-voice-heading">
              <ProviderLogo provider={vp.id} size={16} />
              <span id={`${uid}-vp-${vp.id}`}>{vp.label}</span>
            </p>
            {vp.models.map((m) => (
              <div key={m.id} role="group" aria-label={`${m.name} voices`} className="ai-voice-model">
                <p className="ai-voice-model-name">{m.name}</p>
                <div className="ai-voice-chips">
                  {m.voices.map((v) => {
                    const key = formatVoicePick({ provider: vp.id, model: m.id, voice: v });
                    const on = pickedKey === key;
                    return (
                      <span key={v} className="ai-voice-pick">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`${voiceLabel(v)} · ${m.name} · ${vp.label}`}
                          tabIndex={on ? 0 : -1}
                          className={cn('ai-chip ai-voice-chip', on && 'ai-chip-solid')}
                          onClick={() => onChange(key)}
                        >
                          {voiceLabel(v)}
                        </button>
                        <PreviewButton preview={preview} vkey={key} name={voiceLabel(v)} tabIndex={on ? 0 : -1} />
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p role="status" aria-live="polite" className="ai-voice-preview-note text-[12px] ai-t3 leading-snug">
        {failedKey ? `${failedName}: ${preview.errors[failedKey]}` : ''}
      </p>
    </>
  );
}

/** 11.2 — the voice picker as a sheet over voice chat. */
export function VoicePickerSheet({
  catalog,
  value,
  onChange,
  onClose,
}: {
  catalog: VoiceCatalog | null;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}): ReactNode {
  const titleId = useId();
  const listId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Focus lands on the chosen voice, so arrow keys move through the voices
  // straight away (the sheet's focus trap then keeps it inside; Esc closes).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const body = bodyRef.current;
      const target = body?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? body?.querySelector<HTMLElement>('[role="radio"]');
      target?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, []);
  const note =
    catalog === null
      ? 'Checking which voices are available…'
      : catalog.providers.length
        ? 'Used for voice chat and Read aloud. If a voice is briefly unavailable, this device speaks instead.'
        : 'No studio voice is available right now — replies are spoken by this device.';
  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="lg" layout="column" maxHeight="medium" z={80} className="ai-scope ai-voice-sheet">
      <ChatStyleMark />
      <SheetHeader id={titleId} title="Voice" subtitle="Chat is paused while you choose." onClose={onClose} closeLabel="Close voice picker" />
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        <p id={listId} className="sr-only">
          Spoken reply voice
        </p>
        <VoicePicker catalog={catalog} value={value} onChange={onChange} labelledBy={listId} />
        <p className="mt-1.5 text-[13px] ai-t3 leading-snug">{note}</p>
      </div>
      <div className="flex justify-end pt-3">
        <button type="button" className="ai-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
