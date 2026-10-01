import { HUB_LANGUAGES } from '@/constants/languages';

/**
 * The browse palette (styles/pages/browse.css `.vx-tone-N`): which of the
 * twelve fixed tones each mood and language wears, so a mood or a language
 * looks the same on Discover, Search, Charts, the hubs and anywhere else it
 * appears as a tile.
 */
export const MOOD_TONES: Record<string, number> = {
  romance: 3,
  workout: 5,
  chill: 8,
  party: 9,
  sad: 12,
  devotional: 11,
  travel: 2,
  focus: 10,
};

export function moodTone(id: string): string {
  return `vx-tone-${MOOD_TONES[id] ?? 1}`;
}

/** A language's tone: its place in the hub list, so the tile and the hub header match. */
export function languageTone(id: string): string {
  const at = (HUB_LANGUAGES as readonly string[]).indexOf(id);
  return `vx-tone-${((at < 0 ? 0 : at) % 12) + 1}`;
}
