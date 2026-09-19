import type { HistoryEntry, Song } from '@/types';
import type { TasteProfile } from '@/services/personalization/profile';
import { inferMood, type Mood } from './mood';
import type { SongFeature } from './types';

/**
 * 7.2.0 — how far a feature value can be trusted. Catalogue metadata counts
 * in full, classifier output for less, a keyword read of the title for less
 * still; a value derived from another one (energy or tempo from the mood)
 * multiplies down by DERIVED. Unknown is 0: it contributes nothing.
 */
export const FEATURE_CONFIDENCE = { catalogue: 1, classifier: 0.6, title: 0.35, derived: 0.5 } as const;

export interface FeatureConfidence {
  mood: number;
  energy: number;
  tempo: number;
  genres: number;
  vibes: number;
}

export interface SongProfile {
  id: string;
  language: string | null;
  dialect: string | null;
  subLanguage: string | null;
  genres: string[];
  vibes: string[];
  /** 'neutral' with confidence 0 when nothing is known. */
  mood: Mood;
  /** 0..1; 0.5 (confidence 0) when unknown. */
  energy: number;
  /** BPM; 100 (confidence 0) when unknown. */
  tempo: number;
  artistIds: string[];
  artistNames: string[];
  /** 7.2.0 — 0..1 per feature (see FEATURE_CONFIDENCE). */
  confidence: FeatureConfidence;
}

/**
 * Package A3 / 7.2.0 — true when the song's lead artist is under an active
 * "show fewer like this" (keyed by artist id, or lower-case name when the
 * catalogue gave no id). One definition for the gatherer, the hard filter,
 * validation and the Home shelves.
 */
export function softMutedArtist(song: Song, muted: TasteProfile['softMuted'], now = Date.now()): boolean {
  const lead = song.artists?.[0];
  if (!lead || !muted) return false;
  const entry = (lead.id ? muted[lead.id] : undefined) ?? muted[String(lead.name).toLowerCase()];
  return !!entry && entry.until > now;
}

export interface UserRecommendationProfile {
  languages: Record<string, number>;
  dialects: Record<string, number>;
  subLanguages: Record<string, number>;
  genres: Record<string, number>;
  vibes: Record<string, number>;
  artists: Record<string, number>;
  likedSongIds: Set<string>;
  skippedSongIds: Set<string>;
  recentSongIds: Set<string>;
  avgEnergy: number | null;
  avgTempo: number | null;
  dominantMood: Mood | null;
}

export interface SessionRecommendationProfile {
  recentSongIds: Set<string>;
  avgEnergy: number | null;
  avgTempo: number | null;
  dominantMood: Mood | null;
  dominantLanguage: string | null;
  dominantDialect: string | null;
  size: number;
}

const clean = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const GENRE_HINTS: Array<[RegExp, string]> = [
  [/hip[ -]?hop|rap/i, 'hip-hop'],
  [/rock/i, 'rock'],
  [/classical|orchestra|symphony/i, 'classical'],
  [/devotional|bhajan|qawwali|spiritual/i, 'devotional'],
  [/lo[ -]?fi|chill|ambient|acoustic/i, 'chill'],
  [/party|dance|club|edm|remix/i, 'dance'],
  [/romantic|love|melody|ballad/i, 'romantic'],
];

const VIBE_HINTS: Array<[RegExp, string]> = [
  [/party|dance|club|edm|remix/i, 'upbeat'],
  [/chill|lo[ -]?fi|ambient|sleep/i, 'calm'],
  [/romantic|love|heart/i, 'romantic'],
  [/sad|melancholy|alone|breakup/i, 'melancholy'],
  [/devotional|bhajan|spiritual/i, 'devotional'],
  [/acoustic|unplugged|live/i, 'acoustic'],
];

function textFor(song: Song): string {
  return [song.title, song.subtitle, song.album?.name, song.genre, ...(song.genres ?? []), song.vibe, ...(song.vibes ?? [])].join(' ');
}

function inferred(values: Array<[RegExp, string]>, text: string): string[] {
  return values.filter(([re]) => re.test(text)).map(([, value]) => value);
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Energy (0..1) and tempo (BPM) a mood suggests; the energies match the session tracker's. */
const MOOD_PRIOR: Record<Mood, [number, number]> = { energetic: [0.9, 124], romantic: [0.55, 92], chill: [0.25, 72], melancholy: [0.15, 70], devotional: [0.45, 82], neutral: [0.5, 100] };

/**
 * `classified` lists the features whose value came from the classifier rather
 * than the catalogue (`Candidate.classified`); they are trusted less.
 */
export function buildSongProfile(song: Song, classified: readonly SongFeature[] = []): SongProfile {
  // v7.0.0 — persisted songs are untrusted: one favourite or history entry with a
  // malformed `artists` used to throw here, and the player (rightly) swallows a failed
  // continuation — so a single bad record silently ended autoplay for good.
  const artists = Array.isArray(song.artists) ? song.artists : [];
  const text = textFor(song);
  const given = (f: SongFeature): number => (classified.includes(f) ? FEATURE_CONFIDENCE.classifier : FEATURE_CONFIDENCE.catalogue);
  const supplied = (values: Array<string | null | undefined>): string[] => unique(values.map(clean));
  const suppliedGenres = supplied([...(song.genres ?? []), song.genre]);
  const suppliedVibes = supplied([...(song.vibes ?? []), song.vibe]);
  const hintedGenres = inferred(GENRE_HINTS, text);
  const hintedVibes = inferred(VIBE_HINTS, text);
  const moodHint = clean(song.mood);
  const titleMood = inferMood(song);
  const [mood, moodConf]: [Mood, number] = ['romantic', 'energetic', 'chill', 'melancholy', 'devotional', 'neutral'].includes(moodHint)
    ? [moodHint as Mood, given('mood')]
    : [titleMood, titleMood === 'neutral' ? 0 : FEATURE_CONFIDENCE.title];
  const energyGiven = finite(song.energy);
  const tempoGiven = finite(song.tempo);
  return {
    id: song.id,
    language: song.language ? clean(song.language) : null,
    dialect: song.dialect ? clean(song.dialect) : null,
    subLanguage: song.subLanguage ? clean(song.subLanguage) : null,
    genres: unique([...suppliedGenres, ...hintedGenres]),
    vibes: unique([...suppliedVibes, ...hintedVibes]),
    mood,
    energy: Math.max(0, Math.min(1, energyGiven ?? MOOD_PRIOR[mood][0])),
    tempo: Math.max(40, Math.min(220, tempoGiven ?? MOOD_PRIOR[mood][1])),
    artistIds: artists.map((a) => clean(a?.id)).filter(Boolean),
    artistNames: artists.map((a) => clean(a?.name)).filter(Boolean),
    confidence: {
      mood: moodConf,
      energy: energyGiven !== null ? given('energy') : moodConf * FEATURE_CONFIDENCE.derived,
      tempo: tempoGiven !== null ? given('tempo') : moodConf * FEATURE_CONFIDENCE.derived,
      genres: suppliedGenres.length ? given('genre') : hintedGenres.length ? FEATURE_CONFIDENCE.title : 0,
      vibes: suppliedVibes.length ? given('vibe') : hintedVibes.length ? FEATURE_CONFIDENCE.title : 0,
    },
  };
}

/** Confidence-weighted mean of one numeric feature; null when nothing is known. */
function knownMean(ps: SongProfile[], key: 'energy' | 'tempo'): number | null {
  let sum = 0;
  let weight = 0;
  for (const p of ps) {
    sum += p[key] * p.confidence[key];
    weight += p.confidence[key];
  }
  return weight > 0 ? sum / weight : null;
}

/** The most common KNOWN mood. */
const dominantMood = (ps: SongProfile[]): Mood | null => dominant(ps.filter((p) => p.confidence.mood > 0).map((p) => p.mood));

function bump(map: Record<string, number>, key: string | null, weight: number): void {
  if (key) map[key] = (map[key] ?? 0) + weight;
}

function addSong(map: UserRecommendationProfile, song: Song, weight: number): void {
  const p = buildSongProfile(song);
  bump(map.languages, p.language, weight);
  bump(map.dialects, p.dialect, weight);
  bump(map.subLanguages, p.subLanguage, weight);
  p.genres.forEach((g) => bump(map.genres, g, weight));
  p.vibes.forEach((v) => bump(map.vibes, v, weight));
  p.artistIds.forEach((a) => bump(map.artists, a, weight));
  p.artistNames.forEach((a) => bump(map.artists, `name:${a}`, weight));
}

export function buildUserRecommendationProfile(profile: TasteProfile, favorites: Song[] = [], history: HistoryEntry[] = []): UserRecommendationProfile {
  const out: UserRecommendationProfile = {
    languages: {}, dialects: {}, subLanguages: {}, genres: {}, vibes: {}, artists: {},
    likedSongIds: new Set([...(profile.likedSongIds ?? []), ...favorites.map((s) => s.id)]),
    skippedSongIds: new Set(profile.skippedSongIds ?? []),
    recentSongIds: new Set(profile.recentSongIds ?? []),
    avgEnergy: null, avgTempo: null, dominantMood: null,
  };
  topMap(profile.languages, out.languages);
  topMap(profile.artists, out.artists);
  favorites.forEach((song) => addSong(out, song, 2));
  history.slice(0, 100).forEach((entry, index) => addSong(out, entry.song, Math.max(0.2, 1 - index / 100)));
  // 7.2.0 — averages over what is actually known about the songs, weighted by
  // how far it can be trusted; null (no pull at all) when nothing is known.
  const ps = [...favorites, ...history.map((h) => h.song)].map((s) => buildSongProfile(s));
  out.avgEnergy = knownMean(ps, 'energy');
  out.avgTempo = knownMean(ps, 'tempo');
  out.dominantMood = dominantMood(ps);
  return out;
}

function topMap(source: Record<string, { score: number }> | undefined, target: Record<string, number>): void {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = value.score;
}

function dominant<T extends string>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function buildSessionRecommendationProfile(songs: Song[]): SessionRecommendationProfile {
  const profiles = songs.slice(0, 20).map((s) => buildSongProfile(s));
  return {
    recentSongIds: new Set(profiles.map((p) => p.id)),
    avgEnergy: knownMean(profiles, 'energy'),
    avgTempo: knownMean(profiles, 'tempo'),
    dominantMood: dominantMood(profiles),
    dominantLanguage: dominant(profiles.map((p) => p.language).filter((v): v is string => !!v)),
    dominantDialect: dominant(profiles.map((p) => p.dialect).filter((v): v is string => !!v)),
    size: profiles.length,
  };
}

export function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const b = new Set(right);
  return left.filter((value) => b.has(value)).length / Math.max(left.length, right.length);
}
