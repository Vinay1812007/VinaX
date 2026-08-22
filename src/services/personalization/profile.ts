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
}

const HALF_LIFE_DAYS = 14;
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
  };
}

/** Exponential time decay so yesterday matters more than last month. */
export function applyDecay(profile: TasteProfile, now = Date.now()): void {
  const elapsedDays = (now - profile.updatedAt) / DAY_MS;
  if (elapsedDays <= 0.25) return;
  const factor = Math.pow(0.5, elapsedDays / HALF_LIFE_DAYS);
  for (const a of Object.values(profile.languages)) a.score *= factor;
  for (const a of Object.values(profile.artists)) a.score *= factor;
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
