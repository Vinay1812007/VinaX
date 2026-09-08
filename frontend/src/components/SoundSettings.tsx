/**
 * v5.19.0 — "Sound" settings block: master switch, 5-band equalizer with
 * presets, balance, mono and loudness normalisation. Self-contained (own
 * Section / Row / Toggle markup mirroring SettingsPage) so SettingsPage can
 * drop `<SoundSettings />` in without exporting its private helpers. Mounting
 * starts the settings → engine bridge; the graph itself is a lazy chunk.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { Chip } from '@/components/Chip';
import { WaveIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { EQ_BAND_LABELS, EQ_MAX_DB, EQ_PRESETS, EQ_PRESET_LABELS, useEffectsStatus } from '@/services/audio/effects';
import { initSoundEffects } from '@/services/audio/effectsBridge';

const PRESET_IDS = ['flat', 'bass', 'vocal', 'treble', 'loud', 'podcast'];

function Row({ label, note, children, stack }: { label: string; note?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div
      className={cn(
        'py-3.5 border-b border-[color:var(--glass-border)] last:border-0',
        stack ? 'flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4' : 'flex items-start justify-between gap-4',
      )}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="text-xs text-ink-400 mt-0.5 max-w-md leading-relaxed">{note}</p>}
      </div>
      <div className={stack ? 'sm:shrink-0' : 'shrink-0'}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('w-11 h-6 rounded-full transition-colors relative', on ? 'bg-ember-500' : 'bg-ink-600', disabled && 'opacity-40 cursor-not-allowed')}
    >
      <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[color,background-color,border-color,opacity,transform]', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

// Vertical range: modern engines honour writing-mode on <input type=range>;
// rtl makes the top end the maximum so "up" means "more".
const VERTICAL: CSSProperties = { writingMode: 'vertical-lr', direction: 'rtl' };

function statusText(on: boolean, active: boolean, bypassed: boolean): string {
  if (!on) return 'Off';
  if (bypassed) return 'Not available for this source';
  return active ? 'Active' : 'On';
}

export function SoundSettings() {
  const s = useSettingsStore();
  const status = useEffectsStatus();
  useEffect(() => {
    initSoundEffects();
  }, []);
  const on = s.soundEffects;
  const text = statusText(on, status.active, status.bypassed);
  const setGain = (i: number, v: number) => {
    const next = s.eqGains.slice();
    next[i] = v;
    s.setEqGains(next);
  };

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2.5 px-1 mb-2.5">
        <span className="w-7 h-7 rounded-lg bg-ember-500/15 text-ember-500 flex items-center justify-center shrink-0">
          <WaveIcon className="w-4 h-4" />
        </span>
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-300">Sound</h2>
      </div>
      <div className="rounded-2xl glass-card px-5">
        <Row label="Sound effects" note="Equalizer, balance, mono and loudness. Processed on this device — nothing is uploaded — and uses a little more battery while playing.">
          <Toggle on={on} onChange={s.setSoundEffects} label="Sound effects" />
        </Row>

        <Row stack label="Equalizer" note={on ? 'Pick a preset or drag the bands. ±12 dB.' : 'Turn on sound effects to use the equalizer.'}>
          <div className={cn('flex flex-col gap-3', !on && 'opacity-40')}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Equalizer presets">
              {PRESET_IDS.map((id) => (
                <Chip key={id} active={s.eqPreset === id} onClick={on ? () => s.setEqPreset(id, EQ_PRESETS[id]) : undefined}>
                  {EQ_PRESET_LABELS[id]}
                </Chip>
              ))}
            </div>
            <div className="flex items-end justify-between gap-3 sm:justify-start sm:gap-5" role="group" aria-label="Equalizer bands">
              {EQ_BAND_LABELS.map((band, i) => {
                const v = s.eqGains[i] ?? 0;
                return (
                  <label key={band} className="flex flex-col items-center gap-1.5 text-[11px] text-ink-300">
                    <span className="font-mono tabular-nums text-ink-200" aria-hidden="true">{v > 0 ? `+${v}` : v}</span>
                    <input
                      type="range"
                      min={-EQ_MAX_DB}
                      max={EQ_MAX_DB}
                      step={1}
                      value={v}
                      disabled={!on}
                      onChange={(e) => setGain(i, Number(e.target.value))}
                      aria-label={`${band} Hz band gain`}
                      aria-valuetext={`${v} decibels`}
                      style={VERTICAL}
                      className="h-28 w-6 accent-ember-500 disabled:cursor-not-allowed"
                    />
                    <span>{band}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Row>

        <Row stack label="Balance" note="Shift the mix towards the left or right ear.">
          <div className={cn('flex items-center gap-2', !on && 'opacity-40')}>
            <span className="text-xs text-ink-300 w-3 text-center" aria-hidden="true">L</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={s.balance}
              disabled={!on}
              onChange={(e) => s.setBalance(Number(e.target.value))}
              aria-label="Stereo balance"
              aria-valuetext={s.balance === 0 ? 'Centre' : `${Math.round(Math.abs(s.balance) * 100)}% ${s.balance < 0 ? 'left' : 'right'}`}
              className="w-40 sm:w-48 accent-ember-500 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-ink-300 w-3 text-center" aria-hidden="true">R</span>
            <Chip active={s.balance === 0} onClick={on ? () => s.setBalance(0) : undefined}>Centre</Chip>
          </div>
        </Row>

        <Row label="Mono audio" note="Plays the same sound in both ears — helpful with one earbud or hearing in one ear.">
          <Toggle on={s.mono} onChange={s.setMono} label="Mono audio" disabled={!on} />
        </Row>

        <Row label="Loudness normalisation" note="Evens out volume jumps between quiet and loud songs.">
          <Toggle on={s.normalize} onChange={s.setNormalize} label="Loudness normalisation" disabled={!on} />
        </Row>

        <Row label="Status" note={status.bypassed && on ? 'This track is streamed in a way the effects chain can’t read; it plays untouched. The next song will try again.' : undefined}>
          <span
            role="status"
            aria-live="polite"
            className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', on && !status.bypassed ? 'bg-ember-500/15 text-ember-500' : 'bg-ink-800 text-ink-300')}
          >
            {text}
          </span>
        </Row>
      </div>
    </section>
  );
}
