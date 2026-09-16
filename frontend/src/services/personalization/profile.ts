/**
 * The taste profile is the entire "account": a decayed affinity model stored
 * locally, never uploaded anywhere. Deterministic and explainable.
 */
import { DECAY, MAX_AFFINITY } from './eventWeights';

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
  /** v6.4.0 — per-song affinity (capped at 300 songs, least-recent dropped). Optional: pre-6.4 profiles load unchanged. */
  songs?: Record<string, Affinity>;
  /** v6.4.0 — plays per weekday (0 = Sunday). */
  dayHistogram?: number[];
  /** v6.4.0 — running energy preference from completed plays: sum and count. */
  energyPref?: { sum: number; n: number };
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
  /** Song-level negative/positive memories used by recommendations. */
  skippedSongIds?: string[];
  likedSongIds?: string[];
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
 * summarized as one-liners for catalog recommendations and chat. Never uploaded.
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

// Half-lives live in ./eventWeights (v6.4.0) so tuning has one home.
const DAY_MS = 86_400_000;
const SONG_CAP = 300;

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
    skippedSongIds: [],
    likedSongIds: [],
    softMuted: {},
  };
}

/** Exponential time decay so yesterday matters more than last month.
 *  Package A2: positive affinity fades at HALF_LIFE_DAYS (14d), negative
 *  signals (`skips`) fade at SKIP_HALF_LIFE_DAYS (30d) — skips sting longer
 *  than plays reward. Also GCs expired softMuted entries from A3. */
export function applyDecay(profile: TasteProfile, now = Date.now()): void {
  applyTimeDecay(profile, now);
}

/**
 * v6.4.0 — the decay clock, exported under its own name. Positive scores
 * halve every `positiveHalfLifeDays` since the profile was last touched,
 * skips every `skipHalfLifeDays`; song affinities decay with the rest.
 * Idempotent within a six-hour window so hot paths do not churn.
 */
export function applyTimeDecay(
  profile: TasteProfile,
  now = Date.now(),
  halfLives: { positiveHalfLifeDays: number; skipHalfLifeDays: number } = DECAY,
): void {
  const elapsedDays = (now - profile.updatedAt) / DAY_MS;
  if (elapsedDays <= 0.25) return;
  const posFactor = Math.pow(0.5, elapsedDays / halfLives.positiveHalfLifeDays);
  const negFactor = Math.pow(0.5, elapsedDays / halfLives.skipHalfLifeDays);
  const fade = (a: Affinity): void => {
    a.score *= posFactor;
    a.skips *= negFactor;
  };
  for (const a of Object.values(profile.languages)) fade(a);
  for (const a of Object.values(profile.artists)) fade(a);
  if (profile.songs) for (const a of Object.values(profile.songs)) fade(a);
  // GC expired soft-mutes (natural expiry — no half-life needed, the `until`
  // timestamp handles it). Optional field, tolerant of undefined.
  if (profile.softMuted) {
    for (const [key, entry] of Object.entries(profile.softMuted)) {
      if (entry.until <= now) delete profile.softMuted[key];
    }
  }
  profile.updatedAt = now;
}

/**
 * v6.4.0 — an affinity's score as of `now`, decayed from ITS OWN last signal
 * rather than the profile's last write, for callers that want a per-item
 * view (debug panels, "why this song"). Pure; the stored value is untouched.
 */
export function getDecayedAffinity(a: Affinity | undefined, now = Date.now(), halfLifeDays = DECAY.positiveHalfLifeDays): number {
  if (!a) return 0;
  const days = Math.max(0, (now - a.lastTs) / DAY_MS);
  return a.score * Math.pow(0.5, days / halfLifeDays);
}

const capped = (score: number): number => Math.max(0, Math.min(MAX_AFFINITY, score));

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
  a.score = capped(a.score + delta);
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
  a.score = capped(a.score + delta);
  a.lastTs = now;
  a.name = artistName || a.name;
  if (kind === 'play') a.plays += 1;
  if (kind === 'complete') a.completes += 1;
  if (kind === 'skip') a.skips += 1;
}

/** v6.4.0 — per-song affinity, capped at SONG_CAP entries (least recent dropped). */
export function bumpSong(profile: TasteProfile, songId: string, delta: number, kind: 'play' | 'complete' | 'skip', now = Date.now()): void {
  if (!songId) return;
  if (!profile.songs) profile.songs = {};
  const a = ensureAffinity(profile.songs, songId, blank(now));
  a.score = capped(a.score + delta);
  a.lastTs = now;
  if (kind === 'play') a.plays += 1;
  if (kind === 'complete') a.completes += 1;
  if (kind === 'skip') a.skips += 1;
  const keys = Object.keys(profile.songs);
  if (keys.length > SONG_CAP) {
    const drop = keys.sort((x, y) => profile.songs![x].lastTs - profile.songs![y].lastTs).slice(0, keys.length - SONG_CAP);
    for (const k of drop) delete profile.songs[k];
  }
}

/** 0..1 — how much this listener likes THIS song, relative to their strongest song. */
export function songWeight(profile: TasteProfile, songId: string): number {
  const a = profile.songs?.[songId];
  if (!a || a.score <= 0) return 0;
  const max = Math.max(...Object.values(profile.songs ?? {}).map((x) => x.score), 1);
  return a.score / max;
}

/** v6.4.0 — weekday histogram (0 = Sunday). */
export function bumpDay(profile: TasteProfile, day: number): void {
  if (!profile.dayHistogram || profile.dayHistogram.length !== 7) profile.dayHistogram = [0, 0, 0, 0, 0, 0, 0];
  profile.dayHistogram[((day % 7) + 7) % 7] += 1;
}

/** 0..1 — how much of this listener's play volume lands on `day`, relative to their busiest day. */
export function dayOfWeekWeight(profile: TasteProfile, day: number): number {
  const h = profile.dayHistogram;
  if (!h || h.length !== 7) return 0;
  const max = Math.max(...h, 1);
  return (h[((day % 7) + 7) % 7] ?? 0) / max;
}

/** v6.4.0 — running energy preference from completed plays. */
export function bumpEnergyPref(profile: TasteProfile, energy: number): void {
  if (!Number.isFinite(energy)) return;
  const e = profile.energyPref ?? { sum: 0, n: 0 };
  // Exponential-ish window: keep the last ~50 completions' worth of weight.
  if (e.n >= 50) {
    e.sum = e.sum * (49 / 50) + energy;
  } else {
    e.sum += energy;
    e.n += 1;
  }
  profile.energyPref = e;
}

/** Preferred energy 0..1 from completed plays, or null before five completions. */
export function preferredEnergy(profile: TasteProfile): number | null {
  const e = profile.energyPref;
  if (!e || e.n < 5) return null;
  return Math.max(0, Math.min(1, e.sum / e.n));
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
