import type { AudioQualityPref } from './quality';

/**
 * The four levels' names and bitrates, for the Settings rows and the player's
 * Quality menu. Kept apart from quality.ts so the app shell (the audio engine
 * and the settings store) doesn't load the labels.
 */
export interface QualityLevel {
  value: AudioQualityPref;
  label: string;
  kbps: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { value: 'saver', label: 'Low', kbps: 48 },
  { value: 'low', label: 'Medium', kbps: 96 },
  { value: 'medium', label: 'High', kbps: 160 },
  { value: 'high', label: 'Very high', kbps: 320 },
];

export function qualityLevel(pref: AudioQualityPref): QualityLevel {
  return QUALITY_LEVELS.find((l) => l.value === pref) ?? QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
}
