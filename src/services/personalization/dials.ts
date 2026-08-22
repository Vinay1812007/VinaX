/**
 * Package C3 — the "taste dials" runtime, deliberately split out of the eager
 * profile.ts. The defaults and the human-readable summariser only load with the
 * lazy surfaces that use them (the Taste Profile page and the AI DJ / Home /
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

/** One-liners for the dials the listener has actually moved off neutral, fed to
 *  the AI surfaces as fenced *context* (never as commands). Empty when a dial
 *  sits near the middle, so a default profile adds no prompt noise. */
export function sliderDialLines(s: TasteSliders): string[] {
  const out: string[] = [];
  if (s.adventurous >= 0.7) out.push('Leans adventurous — open to discovery and lesser-known picks.');
  else if (s.adventurous <= 0.3) out.push('Leans familiar — prefers known favourites over deep cuts.');
  if (s.recency >= 0.7) out.push('Prefers fresh, recent releases over older tracks.');
  else if (s.recency <= 0.3) out.push('Prefers timeless classics and older hits.');
  if (s.energy >= 0.7) out.push('Prefers high-energy, beat-driven songs.');
  else if (s.energy <= 0.3) out.push('Prefers mellow, melody-forward songs.');
  if (s.vocalness >= 0.7) out.push('Prefers vocal-forward songs.');
  else if (s.vocalness <= 0.3) out.push('Enjoys instrumental and low-vocal tracks.');
  return out;
}
