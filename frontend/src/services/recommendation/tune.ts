import type { Song } from '@/types';
import type { ArcShape } from './sequencer';

/**
 * v6.5.0 — "Tune this queue": the listener reshapes what plays next with one
 * tap. An intent is a high-priority instruction for the AI DJ plus a
 * deterministic on-device nudge (era, language, title cues) so a tune still
 * works when the model is slow or unavailable.
 */
export type TuneIntent =
  | 'energetic'
  | 'chill'
  | 'romantic'
  | 'melody'
  | 'mass'
  | 'devotional'
  | 'heartbreak'
  | 'classics'
  | 'fresh'
  | 'same-language'
  | 'different-language'
  | 'surprise';

export interface TuneOption {
  id: TuneIntent;
  label: string;
}

export const TUNE_OPTIONS: readonly TuneOption[] = [
  { id: 'energetic', label: 'More energetic' },
  { id: 'chill', label: 'More chill' },
  { id: 'romantic', label: 'More romantic' },
  { id: 'melody', label: 'More melody' },
  { id: 'mass', label: 'More beats' },
  { id: 'devotional', label: 'Devotional' },
  { id: 'heartbreak', label: 'Heartbreak' },
  { id: 'classics', label: 'More classics' },
  { id: 'fresh', label: 'More new' },
  { id: 'same-language', label: 'Same language' },
  { id: 'different-language', label: 'Switch language' },
  { id: 'surprise', label: 'Surprise me' },
];

export const isTuneIntent = (v: unknown): v is TuneIntent => TUNE_OPTIONS.some((o) => o.id === v);

/** "Surprise me" picks a concrete intent at random (never itself). */
export function randomTune(): TuneIntent {
  const pool = TUNE_OPTIONS.filter((o) => o.id !== 'surprise');
  return pool[Math.floor(Math.random() * pool.length)].id;
}

const CURRENT_YEAR = new Date().getFullYear();

/** A high-priority instruction the AI DJ follows while this intent is active. */
export function tunePromptHint(intent: TuneIntent): string {
  switch (intent) {
    case 'energetic':
      return 'Shift the queue toward HIGH-ENERGY, upbeat, fast, danceable songs.';
    case 'chill':
      return 'Shift the queue toward CALM, mellow, slow, relaxing songs.';
    case 'romantic':
      return 'Shift the queue toward ROMANTIC, love and soft melodic songs.';
    case 'melody':
      return 'Favor soulful MELODY-forward songs: strong vocals, gentle instrumentation, unhurried tempo.';
    case 'mass':
      return 'Shift toward MASS/DANCE numbers: thumping beats, high tempo, festival and celebration energy.';
    case 'devotional':
      return "Shift toward DEVOTIONAL/bhakti songs in the listener's languages; keep it respectful and uplifting.";
    case 'heartbreak':
      return 'Shift toward SAD, heartbreak, longing and pathos songs.';
    case 'classics':
      return 'Favor TIMELESS CLASSICS and older hits from earlier eras.';
    case 'fresh':
      return 'Favor NEW and recent releases.';
    case 'same-language':
      return 'Keep EVERY song strictly in the current language.';
    case 'different-language':
      return "Deliberately SWITCH to a different language than the current one (use the listener's preferred / top languages) while keeping the mood.";
    case 'surprise':
      return 'Be more adventurous: add variety, discovery and unexpected-but-fitting picks.';
  }
}

/** The energy arc a tune asks the sequencer for; null keeps the session's own read. */
export function tuneShape(intent: TuneIntent): ArcShape | null {
  switch (intent) {
    case 'energetic':
    case 'mass':
      return 'build';
    case 'chill':
    case 'melody':
    case 'romantic':
    case 'heartbreak':
    case 'devotional':
      return 'wind-down';
    case 'surprise':
      return 'wave';
    default:
      return null;
  }
}

/**
 * Deterministic per-song score nudge for an intent, applied on-device so a
 * tune works even when the AI degrades. Era and language come from catalogue
 * metadata; energy uses the classifier's value when present; the rest lean
 * on title cues and otherwise stay neutral (the DJ carries those intents).
 */
export function tuneScoreAdjust(song: Song, intent: TuneIntent, seedLang: string | null): number {
  const year = song.year ? Number(song.year) : null;
  const energy = typeof song.energy === 'number' ? song.energy : null;
  switch (intent) {
    case 'classics':
      if (!year) return 0;
      return year <= CURRENT_YEAR - 8 ? 0.5 : -0.4;
    case 'fresh':
      if (!year) return 0;
      return year >= CURRENT_YEAR - 1 ? 0.5 : -0.3;
    case 'same-language':
      if (!seedLang) return 0;
      return song.language === seedLang ? 0.3 : -0.6;
    case 'different-language':
      if (!seedLang) return 0;
      return song.language && song.language !== seedLang ? 0.4 : -0.6;
    case 'energetic':
      return energy == null ? 0 : (energy - 0.5) * 0.8;
    case 'chill':
      return energy == null ? 0 : (0.5 - energy) * 0.8;
    case 'devotional':
      return /\b(bhakti|devotional|deva|swamy|swami|shiva|vishnu|ganesha|ganapathi|hanuman|ayyappa|venkateswara|amman|bhajan|keerthana)\b/i.test(song.title) ? 0.6 : 0;
    case 'mass':
      return /\b(mass|beat|dance|dj|item|kick|thara local)\b/i.test(song.title) ? 0.35 : 0;
    case 'melody':
      return /\b(melody|melodies|unplugged|acoustic|lullaby|lofi)\b/i.test(song.title) ? 0.35 : 0;
    default:
      return 0;
  }
}
