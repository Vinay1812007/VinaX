/**
 * Package C5 — mood-pin writers. Split from personalization/session.ts (which
 * is first-load) because only the lazy Now Playing page ever pins or clears;
 * the eager path just reads via getMoodPin.
 */
import { MOOD_PIN_KEY } from '@/services/personalization/session';
import type { Mood } from '@/services/recommendation/mood';

const PIN_MINUTES = 45;

export function pinMood(mood: Mood, minutes = PIN_MINUTES): void {
  try {
    window.sessionStorage.setItem(MOOD_PIN_KEY, JSON.stringify({ m: mood, until: Date.now() + minutes * 60_000 }));
  } catch {
    /* sessionStorage disabled — the pin just doesn't stick */
  }
}

export function clearMoodPin(): void {
  try {
    window.sessionStorage.removeItem(MOOD_PIN_KEY);
  } catch {
    /* ignore */
  }
}
