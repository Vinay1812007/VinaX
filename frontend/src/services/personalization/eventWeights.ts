/**
 * v6.4.0 — one place for the listening-event weights and the decay clock.
 *
 * Every affinity bump in the taste profile goes through these numbers, so
 * product tuning happens here and nowhere else. The cap keeps a single
 * binge (or one spam of favourites) from permanently dominating a profile:
 * a score can never exceed MAX_AFFINITY, and decay keeps pulling it back.
 */
export const EVENT_WEIGHTS = Object.freeze({
  PLAY: 1.0,
  COMPLETE: 2.0,
  FAVORITE: 3.0,
  QUEUE_ADD: 0.5,
  SKIP: -0.75,
  /** "Show fewer like this" — five skips' worth, plus a soft mute. */
  SOFT_MUTE: -3.75,
  /** v7.0.0 — a play that started from the listener's own search: a deliberate choice, not a passive one. */
  SEARCH_PLAY: 1.5,
} as const);

/**
 * v7.0.0 — a skip takes back the PLAY bump the song earned when it started.
 * Without this a song started and skipped at once still NETS +0.25 for its
 * artist and language (PLAY 1.0 + SKIP −0.75), so a listener skipping their
 * way through an artist was slowly taught to the profile as liking them.
 */
export const SKIP_RETRACTS_PLAY = true;

export type ListeningEvent = keyof typeof EVENT_WEIGHTS;

export const DECAY = Object.freeze({
  /** Positive preference loses half its weight this many days after the last signal. */
  positiveHalfLifeDays: 14,
  /** Skips sting longer than plays reward. */
  skipHalfLifeDays: 30,
} as const);

/** Hard ceiling on any single affinity score (language, artist, song). */
export const MAX_AFFINITY = 60;

export const EVENT_WEIGHTS_VERSION = '1.1.0';
