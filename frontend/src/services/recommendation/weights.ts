/**
 * Explainable scoring weights. All feature scores are normalised to 0..1 and
 * multiplied by these values before diversity/discovery re-ranking. Keep this
 * file deliberately boring: product tuning can happen here without touching
 * candidate generation or UI code.
 */
export const RECOMMENDATION_WEIGHTS = Object.freeze({
  mood: 0.16,
  vibe: 0.1,
  language: 0.12,
  dialect: 0.08,
  genre: 0.1,
  energy: 0.1,
  tempo: 0.08,
  artistAffinity: 0.14,
  history: 0.1,
  likes: 0.1,
  skips: 0.12,
  session: 0.12,
  discovery: 0.07,
  popularity: 0.05,
  freshness: 0.04,
  diversity: 0.2,
  /** v6.4.0 — per-song affinity (finishing the same song repeatedly). */
  songAffinity: 0.12,
  /** v6.4.0 — weekday rhythm. */
  dayOfWeek: 0.04,
  /** v7.0.0 — novelty ↔ familiarity swing, signed by the discovery mode (±half of this at the extremes). */
  novelty: 0.16,
  /** v7.0.0 — per extra recent play of the same lead artist beyond two (capped at four steps). */
  artistFatigue: 0.04,
  /** v7.0.0 — this sitting's pull on an artist (skips push, likes / searches / queue-adds pull). */
  intentArtist: 0.18,
  /** v7.0.0 — the same, for a language (moves slower by construction). */
  intentLanguage: 0.08,
  /** v7.0.0 — energy steer learned from what was finished vs. skipped this sitting. */
  intentEnergy: 0.3,
  /** v7.0.0 — a song skipped in this sitting is not offered again while it lasts. */
  intentSkippedSong: 0.4,
} as const);

export const SCORING_WEIGHTS_VERSION = '1.2.0';

export type RecommendationWeightKey = keyof typeof RECOMMENDATION_WEIGHTS;
