/**
 * VinaX AI — Voice settings (from the + menu): the voice that reads replies
 * aloud, and the voice for Live voice (also used when a long reply is read
 * by Gemini). The lists come from GET /api/ai/models. Saved on this device.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { usePrefs } from './prefs';
import type { VoiceInfo } from './types';

const label = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

export function VoiceSettings({ voice, onClose }: { voice: VoiceInfo; onClose(): void }): ReactNode {
  const prefs = usePrefs();
  const box = useRef<HTMLDivElement>(null);
  useDismissOnBack(true, onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('select, button')?.focus();
    return () => back?.focus?.();
  }, []);
  const read = voice.voices.includes(prefs.voice) ? prefs.voice : voice.voices[0];
  const live = voice.liveVoices.includes(prefs.liveVoice) ? prefs.liveVoice : voice.liveVoices[0];
  return (
    <div className="vx-ai-scrim" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vx-ai-voice-title"
        className="vx-ai-dialog vx-ai-voice-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Tab') {
            const f = [...(box.current?.querySelectorAll<HTMLElement>('select:not([disabled]), button') ?? [])];
            const i = f.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
          }
        }}
      >
        <h2 id="vx-ai-voice-title">Voice</h2>
        <label className="vx-ai-field">
          <span>Read aloud voice</span>
          <select value={read} onChange={(e) => prefs.set({ voice: e.target.value })} disabled={!voice.readAloud}>
            {voice.voices.map((v) => <option key={v} value={v}>{label(v)}</option>)}
          </select>
        </label>
        <label className="vx-ai-field">
          <span>Live voice</span>
          <select value={live} onChange={(e) => prefs.set({ liveVoice: e.target.value })} disabled={!voice.live && !voice.readAloud}>
            {voice.liveVoices.map((v) => <option key={v} value={v}>{label(v)}</option>)}
          </select>
          <small>Also reads long replies aloud.</small>
        </label>
        <div className="vx-ai-dialog-row">
          <button type="button" className="vx-ai-chip is-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
