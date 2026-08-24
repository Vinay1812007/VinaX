/**
 * Package C2 — Kid mode's content gate. One tiny module (imported by the
 * first-load player store, so it must stay tiny): when the toggle is on,
 * songs the catalog flags as explicit are filtered from every intake and
 * ranking path. Honest limitation, documented in the Settings copy: the
 * filter is only as good as the catalog's explicit flags.
 */
import { useSettingsStore } from '@/store/settingsStore';

export function kidModeOn(): boolean {
  return useSettingsStore.getState().kidMode;
}

/** Strip explicit-flagged songs when kid mode is on; identity otherwise. */
export function stripExplicit<T extends { explicit?: boolean }>(songs: T[]): T[] {
  return kidModeOn() ? songs.filter((s) => !s.explicit) : songs;
}
