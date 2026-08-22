import type { Song } from '@/types';

export type Mood = 'romantic' | 'energetic' | 'chill' | 'melancholy' | 'devotional' | 'neutral';

// Order matters: more specific moods first so e.g. a devotional title is not
// mislabelled romantic. Keyword sets are multilingual (Indian-music aware).
const KEYWORDS: Array<[Mood, RegExp]> = [
  ['devotional', /\b(god|bhajan|devotional|mantra|prayer|ayyappa|shiva|krishna|rama|allah|hanuman|durga|bhakti|aarti|kirtan)\b/],
  ['romantic', /\b(love|loving|romance|romantic|pyaar|pyar|prema|prem|dil|heart|kiss|valentine|kaadhal|priya|crush|jaan|sweet|cute)\b/],
  ['energetic', /\b(party|dance|dj|club|beat|rock|mass|blast|dhol|bhangra|thumka|nonstop|remix|banger|hyper)\b/],
  ['melancholy', /\b(sad|alone|tears|broken|breakup|miss|dard|viraham|cry|lonely|heartbreak|judaai|gham)\b/],
  ['chill', /\b(chill|lofi|lo-fi|slow|soft|melody|acoustic|rain|night|sleep|calm|soothing|relax|unplugged)\b/],
];

/**
 * Best-effort mood inference from a song's title + subtitle keywords.
 * Deterministic and intentionally rough — a true audio mood would need audio
 * analysis the catalog does not expose; this is a lightweight signal that
 * complements the AI curator's deeper mood matching.
 */
export function inferMood(song: Song | null | undefined): Mood {
  if (!song) return 'neutral';
  const text = `${song.title} ${song.subtitle}`.toLowerCase();
  for (const [mood, re] of KEYWORDS) {
    if (re.test(text)) return mood;
  }
  return 'neutral';
}

/** 0..1 mood similarity; 'neutral' stays flexible so it never over-penalizes. */
export function moodMatchScore(a: Mood, b: Mood): number {
  if (a === b) return 1;
  if (a === 'neutral' || b === 'neutral') return 0.4;
  return 0.1;
}
