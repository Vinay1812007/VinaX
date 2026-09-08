/**
 * v5.19.0 — settings → engine bridge for the sound-effects chain (lazy).
 * Subscribes to the settings store once and forwards changes: the master
 * toggle drives `audioEngine.setEffectsEnabled`, everything else goes to the
 * live graph through `applyEffects`. Called by the SoundSettings block on
 * mount and by the engine itself when effects are on at boot, so neither
 * AppLayout nor the first-load bundle ever imports the graph code.
 */
import { useSettingsStore, type SettingsState } from '@/store/settingsStore';
import { audioEngine } from '@/services/audio/engine';
import { applyEffects } from '@/services/audio/effects';

let started = false;

function pick(s: SettingsState) {
  return { eqGains: s.eqGains, balance: s.balance, mono: s.mono, normalize: s.normalize };
}

export function initSoundEffects(): void {
  if (started) return;
  started = true;
  const s = useSettingsStore.getState();
  applyEffects(pick(s));
  audioEngine.setEffectsEnabled(s.soundEffects);
  useSettingsStore.subscribe((next, prev) => {
    if (next.soundEffects !== prev.soundEffects) audioEngine.setEffectsEnabled(next.soundEffects);
    if (
      next.eqGains !== prev.eqGains ||
      next.balance !== prev.balance ||
      next.mono !== prev.mono ||
      next.normalize !== prev.normalize
    ) {
      applyEffects(pick(next));
    }
  });
}
