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
} as const);

export const SCORING_WEIGHTS_VERSION = '1.1.0';

export type RecommendationWeightKey = keyof typeof RECOMMENDATION_WEIGHTS;
