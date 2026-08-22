/**
 * Shared per-request variety helpers for the AI generators (v3.6.0+).
 *
 * The AI Playlist fix (v3.3.1) proved that a fresh varietySeed — a crypto nonce
 * plus the current IST date-hour — injected into the prompt with an explicit
 * "treat this as a shuffle seed, consecutive runs MUST differ" rule is what
 * stops identical requests from re-serving one canonical result. This module
 * lifts that seed out of playlist.ts so Home (/api/home) and the AI DJ
 * (/api/dj) can ride the exact same pattern. playlist.ts keeps its own copy for
 * its locked test surface.
 *
 * The v3.7.1 anti-repetition pass adds:
 *  - styleAngle(): a rotating creative direction picked from a large pool so
 *    consecutive AI Playlist / AI DJ generations for the SAME prompt land in
 *    different neighborhoods (rare cuts vs. collabs vs. live versions vs. ...).
 *  - discoveryFocus(): a bigger, deterministic-from-seed replacement for the
 *    client-side Math.random discoveryFocus (six options → thirteen), so the
 *    "editorial direction" itself rotates round to round.
 *  - hashSeed(): stable 32-bit PRNG from a seed string so pool/shelf/angle
 *    rotation is deterministic for a given varietySeed (helpful for tests and
 *    for the fallback shelves' rotation logic).
 */

/** Per-request variety seed: crypto nonce + IST date-hour. Injected into a
 *  prompt with an explicit shuffle-seed rule so identical requests still
 *  explore different picks each round. */
export function varietySeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const ist = new Date(Date.now() + 5.5 * 3_600_000).toISOString(); // IST = UTC+5:30
  return `${nonce} · IST ${ist.slice(0, 10)} ${ist.slice(11, 13)}h`;
}

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
 * Rotating creative angles for the AI Playlist and AI DJ. Consecutive
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

/**
 * Discovery focus for the AI DJ — the "vibe of this round". Bigger and more
 * varied than the six-option Math.random the client used to send, and picked
 * deterministically from the seed so it rotates as the seed does.
 */
const DISCOVERY_FOCI: readonly string[] = [
  'a balanced mix',
  'deeper cuts and lesser-known gems',
  'recent releases from the last 18 months',
  'timeless classics — 90s and earlier',
  'an upbeat, high-energy set',
  'a mellow, easy-listening set',
  'crossover picks — songs one language borrows from another',
  'songs that showcase a specific instrument (violin, flute, tabla, or the seed\'s dominant sound)',
  'film-song heavy — cinema soundtracks and OST tracks',
  'independent / non-film releases — the parallel-scene',
  'ensemble and duet tracks over solo vocal cuts',
  'songs from acclaimed albums rather than singles-only artists',
  'reworked and reimagined versions — remasters, remixes, MTV Unplugged, live sets',
];

/** Deterministically pick a discovery focus. */
export function discoveryFocus(seed: string): string {
  return pickBySeed(DISCOVERY_FOCI, seed, 'focus');
}
