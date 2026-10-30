/**
 * Package C3 — the "taste dials" runtime, deliberately split out of the eager
 * profile.ts. The defaults and the human-readable summariser only load with the
 * lazy surfaces that use them (the Taste Profile page and the playlist /
 * chat payload builders), so first-load stays lean. This module is kept pure
 * (types-only imports) so it never perturbs the eager chunk graph; the one
 * setter that needs storage lives with its sole caller, the Taste Profile page.
 */
import type { TasteProfile, TasteSliders } from './profile';

export const DEFAULT_SLIDERS: TasteSliders = {
  adventurous: 0.5,
  recency: 0.5,
  energy: 0.5,
  vocalness: 0.5,
};

/** Slider values with neutral defaults filled in for any profile predating C3. */
export function getSliders(profile: TasteProfile): TasteSliders {
  return { ...DEFAULT_SLIDERS, ...(profile.sliders ?? {}) };
}

