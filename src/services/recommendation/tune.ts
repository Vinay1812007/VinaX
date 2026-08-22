import type { Song } from '@/types';

/** "Tune this queue" intents the listener can apply to reshape the AI queue. */
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

const CURRENT_YEAR = new Date().getFullYear();

/** A high-priority instruction the AI curator follows while this intent is active. */
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

/**
 * Deterministic per-song score nudge for an intent, applied client-side so a
 * tune works even when the AI degrades. Only era and language are reliably
 * known from catalog metadata; mood/energy intents are AI-driven (return 0).
 */
export function tuneScoreAdjust(song: Song, intent: TuneIntent, seedLang: string | null): number {
  const year = song.year ? Number(song.year) : null;
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
