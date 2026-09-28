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

/**
 * 8.2.0 — the next-song engine's newer terms. Kept OUT of DEFAULT_WEIGHTS on
 * purpose: that table is the owner console's override contract, mirrored
 * key for key by the Worker (clientConfig.ts, pinned by a parity test), so a
 * key added there must land in both at once. Until then these are fixed
 * defaults, read by the scorer like the table above, and not overridable.
 * Each value was checked against the offline evaluation (scripts/eval-recs.mjs).
 */
export const TASTE_WEIGHTS = Object.freeze({
  /**
   * Taste fit: the cosine (0..1) of the candidate's on-device vector and the
   * listener's taste vector (favourites + decayed history, ./vectors.ts),
   * times this, times the personal blend (confidence × intensity).
   */
  tasteFit: 0.15,
  /** A song another surface showed in the last week (songIdentity's served memory). */
  servedRecently: 0.04,
  /** A song that opened the last continuation the player accepted after this same seed. */
  seedRepeat: 0.1,
} as const);

/**
 * 8.3.0 — keeping a style going (DJ remixes, folk, devotional; ./style.ts).
 * Fixed defaults like TASTE_WEIGHTS, outside the owner-override contract for
 * the same reason. Applied only while a style is active (the context's
 * `style`); every other continuation and every Home shelf scores as before.
 *
 * Sized against the rest of the score: a candidate's total is typically
 * 0.4–1.2, the strongest source boost is 0.24 and the language match 0.12.
 * The gap between an in-style song (+match) and an off-style one (offStyle)
 * is 0.7 — more than any one taste term — so a film song that fits the
 * listener's taste well does not outrank a DJ remix in a DJ session, while
 * the off-style cost alone rarely takes a song to zero (the ranker drops
 * those): an off-style song stays in the pool for when the style runs dry.
 * Validation then holds the stretch to STYLE_MIN_SHARE (validation.ts).
 * Checked against the offline evaluation's style fixtures (scripts/eval-recs.mjs).
 */
export const STYLE_WEIGHTS = Object.freeze({
  /** A song that says the style in its title, album or credits. */
  match: 0.4,
  /** A song whose style is only in its genre / mood metadata (the classifier's guess counts for less). */
  metaMatch: 0.25,
  /** A song outside the style. */
  offStyle: -0.3,
  /** The catalogue search for the style, as a source: broad like the genre source, a little above it. */
  sourceBoost: 0.1,
} as const);

/**
 * 8.3.0 — the share of a stretch that must be in the style while the pool
 * holds enough such songs: ⌈0.8 × 5⌉ = 4 of the next five. It gives way
 * only when the pool runs short of the style (validation.ts, rule 'style').
 */
export const STYLE_MIN_SHARE = 0.8;

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
