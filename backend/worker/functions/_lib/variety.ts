/** Rotating creative directions for AI playlists. */

/** Stable 32-bit FNV-1a hash. Deterministic for tests, cheap at runtime. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick one element from `pool` deterministically from `seed`. Different
 *  `salt` values pick independently — pass a different salt for each field
 *  you want to rotate (e.g. 'style', 'angle', 'focus'). */
export function pickBySeed<T>(pool: readonly T[], seed: string, salt = ''): T {
  return pool[hashSeed(`${salt}|${seed}`) % pool.length];
}

/**
 * Rotating creative angles for the AI Playlist. Consecutive
 * generations for the SAME prompt/seed rotate through these, so the same
 * user's "energetic Telugu songs" today and tomorrow read as different
 * playlists — the model is nudged into a different neighborhood each time.
 */
const STYLE_ANGLES: readonly string[] = [
  'lean toward beloved deep cuts and B-sides — songs fans know but streaming charts don\'t',
  'lean toward live recordings, unplugged versions and MTV Unplugged cuts where they exist',
  'lean toward collaborations — duets, guest features, one-off cross-artist tracks',
  'lean toward soundtrack picks — film songs and OST cuts from acclaimed movies',
  'lean toward indie / non-film releases and the parallel-scene artists worth knowing',
  'lean toward the very newest arrangements — post-2024 remixes, refreshed versions, current-generation covers',
  'lean toward under-the-radar hits that peaked on regional charts but never quite crossed over',
  'lean toward songs that share instrumentation or production style rather than obvious genre siblings',
  'lean toward tracks a working music director would slot for their sonic transitions, not their titles',
  'lean toward vocal-showcase cuts — the songs where the singer\'s craft is the whole point',
  'lean toward producer-driven picks — the composers/arrangers whose signature is unmistakable',
  'lean toward mood-siblings from a completely different era than the seed would suggest',
];

/** Deterministically pick a style angle for this request. */
export function styleAngle(seed: string): string {
  return pickBySeed(STYLE_ANGLES, seed, 'angle');
}
