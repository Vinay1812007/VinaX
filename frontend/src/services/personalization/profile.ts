/**
 * The taste profile is the entire "account": a decayed affinity model stored
 * locally, never uploaded anywhere. Deterministic and explainable.
 */
export interface Affinity {
  score: number;
  plays: number;
  completes: number;
  skips: number;
  lastTs: number;
}

export interface ArtistAffinity extends Affinity {
  name: string;
}

export interface TasteProfile {
  version: 1;
  createdAt: number;
  updatedAt: number;
  languages: Record<string, Affinity>;
  artists: Record<string, ArtistAffinity>;
  /** Plays per hour-of-day, for time-of-day shelves and insights. */
  hourHistogram: number[];
  totals: {
    plays: number;
    completes: number;
    skips: number;
    favorites: number;
    queueAdds: number;
  };
  /** Recently played song ids — repetition guard for recommendations. */
  recentSongIds: string[];
  /** Per-language play counts bucketed by 6h slice (0=night,1=morning,2=afternoon,3=evening). */
  hourBuckets: Record<string, number[]>;
  /** Package A3 — "Show fewer like this". Artist keys the user explicitly
   *  demoted; entries expire after `until`. Optional so existing v1 profiles
   *  in the wild that predate this field keep loading cleanly. */
  softMuted?: Record<string, { until: number }>;
  /** Package C3 — four hand-tuned "taste dials". Optional so v1 profiles that
   *  predate C3 keep loading; getSliders() fills the neutral defaults. Stays on
   *  schema version 1 — it's an additive, defaulted field, not a shape change. */
  sliders?: TasteSliders;
}

/**
 * Package C3 — the taste dials. Each is a 0..1 position where 0.5 is neutral
 * ("let my listening decide"). They bias the on-device scorer directly and are
 * summarized as one-liners for the AI DJ / Home / chat. Never uploaded.
 */
export interface TasteSliders {
  /** 0 = stick to familiar favourites · 1 = adventurous, discovery-first. */
  adventurous: number;
  /** 0 = timeless classics · 1 = fresh, recent releases. */
  recency: number;
  /** 0 = mellow, melody-forward · 1 = high-energy, beat-driven. */
  energy: number;
  /** 0 = instrumental-friendly · 1 = vocal-forward. */
  vocalness: number;
}

export type SliderKey = keyof TasteSliders;

// The dials' runtime (defaults, summariser, setter) lives in the lazy-loaded
// ./dials module, not here — profile.ts is first-load, and only lazy surfaces
// (the Taste Profile page and the AI payload builders) ever touch that runtime,
// so keeping it out holds the first-load bundle flat. Only the TYPES stay here.

const HALF_LIFE_DAYS = 14;
// Negative-preference decay is slower than positive — a skip should sting
// longer than a play should reward. Package A2 upgrades applyDecay to
// exponentially fade `skips` at this half-life so a year-old skip doesn't
// keep demoting an artist forever.
const SKIP_HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;

export function createEmptyProfile(now = Date.now()): TasteProfile {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    languages: {},
    artists: {},
    hourHistogram: new Array(24).fill(0),
    hourBuckets: {},
    totals: { plays: 0, completes: 0, skips: 0, favorites: 0, queueAdds: 0 },
    recentSongIds: [],
    softMuted: {},
  };
}

/** Exponential time decay so yesterday matters more than last month.
 *  Package A2: positive affinity fades at HALF_LIFE_DAYS (14d), negative
 *  signals (`skips`) fade at SKIP_HALF_LIFE_DAYS (30d) — skips sting longer
 *  than plays reward. Also GCs expired softMuted entries from A3. */
export function applyDecay(profile: TasteProfile, now = Date.now()): void {
  const elapsedDays = (now - profile.updatedAt) / DAY_MS;
  if (elapsedDays <= 0.25) return;
  const posFactor = Math.pow(0.5, elapsedDays / HALF_LIFE_DAYS);
  const negFactor = Math.pow(0.5, elapsedDays / SKIP_HALF_LIFE_DAYS);
  for (const a of Object.values(profile.languages)) {
    a.score *= posFactor;
    a.skips *= negFactor;
  }
  for (const a of Object.values(profile.artists)) {
    a.score *= posFactor;
    a.skips *= negFactor;
  }
  // GC expired soft-mutes (natural expiry — no half-life needed, the `until`
  // timestamp handles it). Optional field, tolerant of undefined.
  if (profile.softMuted) {
    for (const [key, entry] of Object.entries(profile.softMuted)) {
      if (entry.until <= now) delete profile.softMuted[key];
    }
  }
  profile.updatedAt = now;
}

function ensureAffinity<T extends Affinity>(map: Record<string, T>, key: string, init: T): T {
  if (!map[key]) map[key] = init;
  return map[key];
}

const blank = (now: number): Affinity => ({ score: 0, plays: 0, completes: 0, skips: 0, lastTs: now });

export function bumpLanguage(
  profile: TasteProfile,
  language: string | null,
  delta: number,
  kind: 'play' | 'complete' | 'skip',
  now = Date.now(),
): void {
  if (!language) return;
  const a = ensureAffinity(profile.languages, language, blank(now));
  a.score = Math.max(0, a.score + delta);
  a.lastTs = now;
  if (kind === 'play') a.plays += 1;
  if (kind === 'complete') a.completes += 1;
  if (kind === 'skip') a.skips += 1;
}

export function bumpArtist(
  profile: TasteProfile,
  artistId: string,
  artistName: string,
  delta: number,
  kind: 'play' | 'complete' | 'skip',
  now = Date.now(),
): void {
  if (!artistId && !artistName) return;
  const nameKey = `name:${artistName.toLowerCase()}`;
  const key = artistId || nameKey;
  // Wrappers are inconsistent about artist IDs: merge any orphaned name-keyed
  // affinity into the canonical ID-keyed entry the first time we see the ID.
  if (artistId && profile.artists[nameKey] && !profile.artists[key]) {
    profile.artists[key] = { ...profile.artists[nameKey] };
    delete profile.artists[nameKey];
  }
  const a = ensureAffinity(profile.artists, key, { ...blank(now), name: artistName });
  a.score = Math.max(0, a.score + delta);
  a.lastTs = now;
  a.name = artistName || a.name;
  if (kind === 'play') a.plays += 1;
  if (kind === 'complete') a.completes += 1;
  if (kind === 'skip') a.skips += 1;
}

export function rememberRecent(profile: TasteProfile, songId: string): void {
  profile.recentSongIds = [songId, ...profile.recentSongIds.filter((i) => i !== songId)].slice(0, 60);
}

/** 0..3 — which 6-hour slice of the day an hour falls into. */
export function bucketOfHour(hour: number): number {
  return Math.min(3, Math.floor((((hour % 24) + 24) % 24) / 6));
}

export function bumpHourBucket(profile: TasteProfile, language: string | null, hour: number): void {
  if (!language) return;
  if (!profile.hourBuckets[language]) profile.hourBuckets[language] = [0, 0, 0, 0];
  profile.hourBuckets[language][bucketOfHour(hour)] += 1;
}

/** 0..1 — how strongly this language is one you play at the current time of day. */
export function timeOfDayWeight(profile: TasteProfile, language: string | null, hour: number): number {
  if (!language) return 0;
  const b = profile.hourBuckets?.[language];
  if (!b) return 0;
  const max = Math.max(...b, 1);
  return (b[bucketOfHour(hour)] ?? 0) / max;
}

/** Completion ratio (0..1) of the strongest-affinity matching artist; 0.5 when unknown. */
export function artistSkipScore(profile: TasteProfile, artistIds: string[], artistNames: string[]): number {
  let best: ArtistAffinity | null = null;
  for (const id of artistIds) {
    const a = profile.artists[id];
    if (a && (!best || a.score > best.score)) best = a;
  }
  for (const name of artistNames) {
    const a = profile.artists[`name:${name.toLowerCase()}`];
    if (a && (!best || a.score > best.score)) best = a;
  }
  return best ? lowSkipScore(best) : 0.5;
}

export function topLanguages(profile: TasteProfile, n = 4): Array<{ id: string; affinity: Affinity }> {
  return Object.entries(profile.languages)
    .filter(([id]) => id !== 'unknown')
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, n)
    .map(([id, affinity]) => ({ id, affinity }));
}

export function topArtists(profile: TasteProfile, n = 8): Array<{ key: string; affinity: ArtistAffinity }> {
  return Object.entries(profile.artists)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, n)
    .map(([key, affinity]) => ({ key, affinity }));
}

/** 0..1 — how much signal the profile actually has. Drives cold-start blending. */
export function profileConfidence(profile: TasteProfile): number {
  const signal = profile.totals.plays + profile.totals.favorites * 3 + profile.totals.completes;
  return Math.min(1, signal / 40);
}

export function languageWeight(profile: TasteProfile, language: string | null): number {
  if (!language) return 0;
  const a = profile.languages[language];
  if (!a) return 0;
  const max = Math.max(...Object.values(profile.languages).map((x) => x.score), 1);
  return a.score / max;
}

export function artistWeight(profile: TasteProfile, artistIds: string[], artistNames: string[]): number {
  const max = Math.max(...Object.values(profile.artists).map((x) => x.score), 1);
  let best = 0;
  for (const id of artistIds) {
    const a = profile.artists[id];
    if (a) best = Math.max(best, a.score / max);
  }
  for (const name of artistNames) {
    const a = profile.artists[`name:${name.toLowerCase()}`];
    if (a) best = Math.max(best, a.score / max);
  }
  return best;
}

export function lowSkipScore(a: Affinity): number {
  const total = a.completes + a.skips;
  if (total < 3) return 0.5;
  return a.completes / total;
}

/** Most recent listen timestamp across the given artists, or null. */
export function artistLastSeen(
  profile: TasteProfile,
  artistIds: string[],
  artistNames: string[],
): number | null {
  let last: number | null = null;
  for (const id of artistIds) {
    const a = profile.artists[id];
    if (a && (last == null || a.lastTs > last)) last = a.lastTs;
  }
  for (const name of artistNames) {
    const a = profile.artists[`name:${name.toLowerCase()}`];
    if (a && (last == null || a.lastTs > last)) last = a.lastTs;
  }
  return last;
}
