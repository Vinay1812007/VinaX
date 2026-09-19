/**
 * Explainable scoring weights. All feature scores are normalised to 0..1 and
 * multiplied by these values before diversity/discovery re-ranking. Keep this
 * file deliberately boring: product tuning can happen here without touching
 * candidate generation or UI code.
 *
 * 7.2.0 — the owner console can publish bounded overrides (Recommendation
 * Tuning, config key `rec-config`). RECOMMENDATION_WEIGHTS is the LIVE object
 * the scorer and the re-ranker read on every call: applyWeightOverrides()
 * rewrites it in place from the defaults below, resetWeightOverrides() puts
 * the defaults back. The Worker mirrors DEFAULT_WEIGHTS for its own
 * validation (backend/worker/functions/_lib/clientConfig.ts, pinned by a test
 * that parses this literal), so keep it a plain `key: number` list.
 */
const DEFAULT_WEIGHTS = Object.freeze({
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

export type RecommendationWeightKey = keyof typeof DEFAULT_WEIGHTS;
export type RecommendationWeights = Record<RecommendationWeightKey, number>;

/** The shipped defaults (frozen). */
export const DEFAULT_RECOMMENDATION_WEIGHTS: Readonly<RecommendationWeights> = DEFAULT_WEIGHTS;

/** The effective weights: the defaults plus any applied override. Only this module writes it. */
export const RECOMMENDATION_WEIGHTS: Readonly<RecommendationWeights> = { ...DEFAULT_WEIGHTS };
const live = RECOMMENDATION_WEIGHTS as RecommendationWeights;

/** An override is clamped to half … double its default (the Worker applies the same rule). */
export const WEIGHT_OVERRIDE_MIN_FACTOR = 0.5;
export const WEIGHT_OVERRIDE_MAX_FACTOR = 2;

let active: { version: number; variant: string | null; keys: RecommendationWeightKey[] } | null = null;

/**
 * Apply published overrides on top of the DEFAULTS (never on top of an
 * earlier override). Only known keys with finite numbers count, each clamped
 * into its safe range; anything else is ignored. Returns the keys applied —
 * none (or no valid version) means the defaults stand, as after a reset.
 */
export function applyWeightOverrides(overrides: Readonly<Record<string, unknown>> | null | undefined, meta: { version: number; variant: string | null }): RecommendationWeightKey[] {
  Object.assign(live, DEFAULT_WEIGHTS);
  active = null;
  if (!overrides || typeof overrides !== 'object' || !Number.isInteger(meta.version) || meta.version < 1) return [];
  const keys: RecommendationWeightKey[] = [];
  for (const k of Object.keys(DEFAULT_WEIGHTS) as RecommendationWeightKey[]) {
    const v = overrides[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const d = DEFAULT_WEIGHTS[k];
    live[k] = Math.min(d * WEIGHT_OVERRIDE_MAX_FACTOR, Math.max(d * WEIGHT_OVERRIDE_MIN_FACTOR, v));
    keys.push(k);
  }
  if (keys.length) active = { version: meta.version, variant: meta.variant, keys };
  return keys;
}

export function resetWeightOverrides(): void {
  Object.assign(live, DEFAULT_WEIGHTS);
  active = null;
}

/** "1.2.0" on the defaults; "1.2.0+rc7" while published config version 7 is applied. */
export function activeWeightsVersion(): string {
  return active ? `${SCORING_WEIGHTS_VERSION}+rc${active.version}` : SCORING_WEIGHTS_VERSION;
}

/** The applied override (config version, experiment variant, keys), or null on the defaults. */
export function activeWeightOverride(): Readonly<{ version: number; variant: string | null; keys: readonly RecommendationWeightKey[] }> | null {
  return active;
}
