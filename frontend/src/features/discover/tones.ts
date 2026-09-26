/**
 * The browse palette (styles/pages/browse.css `.vx-tone-N`): which of the
 * twelve fixed tones each mood tile wears, so a mood looks the same on the
 * Moods page, Charts and anywhere else it appears as a tile.
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
