import type { HistoryEntry, Song } from '@/types';
import { isSkippedPlay } from '@/utils/plays';
import { buildSongProfile, type SongProfile } from './profiles';
import type { SongFeature } from './types';

/**
 * 8.2.0 — on-device taste vectors.
 *
 * A song becomes a small, fixed-length vector by feature hashing: each of
 * its descriptive features (artists, album, language, genres, mood, vibes,
 * release decade) is hashed to one of VECTOR_DIM slots with a hashed sign
 * and a per-kind weight, and the vector is scaled to unit length. The
 * listener's taste is the weighted sum of the vectors of what they love
 * (favourites, at full weight) and what they played lately (decayed by age:
 * finished plays add, skips subtract), scaled to unit length too. How well a
 * candidate fits is the cosine of the two: 1 = made of exactly the same
 * features, 0 = nothing in common.
 *
 * Deterministic, synchronous and entirely local: no model, no network, no
 * randomness. Two songs that share nothing can still collide in a slot; with
 * 256 slots and a dozen features a song, that noise is small next to a real
 * shared artist or album.
 *
 * A stronger learned embedding (services/ai/embeddings.ts) can refine the
 * fit when the device already holds vectors for both the listener's taste
 * songs and the candidate. The two spaces are never compared with each
 * other: see `embeddingTasteVector` and the scorer's taste term.
 */
export const VECTOR_DIM = 256;

/** How much each kind of feature counts in a song's vector. */
export const FEATURE_WEIGHTS = {
  leadArtist: 1,
  otherArtist: 0.5,
  album: 0.5,
  language: 0.3,
  genre: 0.5,
  mood: 0.4,
  vibe: 0.35,
  decade: 0.3,
} as const;

/** A play this old counts for half in the taste vector. */
export const TASTE_HALF_LIFE_MS = 14 * 86_400_000;
/** At most this many favourites and history entries feed the taste vector. */
const MAX_FAVORITES = 60;
const MAX_HISTORY = 200;
/** A history entry's weight by outcome (before age decay). */
const PLAY_WEIGHT = { completed: 1, skipped: -0.5, other: 0.25 } as const;
/** The learned-embedding taste needs at least this many taste songs with a cached vector. */
export const MIN_EMBEDDED_TASTE_SONGS = 3;
/**
 * 9.0.0 — plays younger than this are the listener's RECENT taste; older plays
 * and favourites are the LONG-TERM taste. Recent listening may hold at most
 * RECENT_SHARE of the taste's weight once the long-term taste weighs at least
 * MIN_LONG_TERM_MASS (three favourites, say), so one unusual week (a party, a
 * binge on one new artist) cannot take the taste over, however many plays it
 * holds. Below the cap the taste is the same weighted sum as in 8.x, where
 * fifty plays of one night outweighed a few dozen favourites. A thin or very
 * old long-term taste is not protected: then recent listening IS the taste.
 */
export const RECENT_WINDOW_MS = 7 * 86_400_000;
export const RECENT_SHARE = 0.4;
export const MIN_LONG_TERM_MASS = 3;

/** FNV-1a, 32-bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const norm = (v: string | null | undefined): string => String(v ?? '').trim().toLowerCase();

function put(vec: Float32Array, feature: string, weight: number): void {
  if (!weight) return;
  const h = hash(feature);
  vec[h % VECTOR_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
}

function unit(vec: Float32Array): Float32Array | null {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  if (!(sum > 0)) return null;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  return vec;
}

/** The dot product; for two unit vectors, their cosine. 0 when either is missing or the lengths differ. */
export function dot(a: Float32Array | null | undefined, b: Float32Array | null | undefined): number {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * A song's unit vector, or null when it has no usable feature at all.
 * Genres and vibes include the ones the title suggests (as the scorer's
 * song profile reads them); a mood counts only when something named it.
 * Pass the song's `profile` when it is already built (the scorer has it).
 */
export function songVector(song: Song, classified: readonly SongFeature[] = [], profile?: SongProfile): Float32Array | null {
  const vec = new Float32Array(VECTOR_DIM);
  const artists = Array.isArray(song?.artists) ? song.artists : [];
  artists.forEach((a, i) => {
    const key = norm(a?.id) || norm(a?.name);
    if (key) put(vec, `a:${key}`, i === 0 ? FEATURE_WEIGHTS.leadArtist : FEATURE_WEIGHTS.otherArtist);
  });
  const album = norm(song?.album?.id) || norm(song?.album?.name);
  if (album) put(vec, `al:${album}`, FEATURE_WEIGHTS.album);
  const language = norm(song?.language);
  if (language && language !== 'unknown') put(vec, `l:${language}`, FEATURE_WEIGHTS.language);
  const p = profile ?? buildSongProfile(song, classified);
  for (const g of p.genres) put(vec, `g:${g}`, FEATURE_WEIGHTS.genre);
  for (const v of p.vibes) put(vec, `v:${v}`, FEATURE_WEIGHTS.vibe);
  if (p.confidence.mood > 0 && p.mood !== 'neutral') put(vec, `m:${p.mood}`, FEATURE_WEIGHTS.mood);
  const year = Number(song?.year);
  if (Number.isFinite(year) && year > 1900) put(vec, `d:${Math.floor(year / 10) * 10}`, FEATURE_WEIGHTS.decade);
  return unit(vec);
}

export interface TasteSong {
  song: Song;
  weight: number;
  /** 9.0.0 — 'recent' for a play inside RECENT_WINDOW_MS; favourites and older plays are 'long'. */
  part: 'long' | 'recent';
}

/**
 * The songs that make up the listener's taste, with their weights:
 * favourites at 1, then plays decayed by age (half-life TASTE_HALF_LIFE_MS)
 * — a finished play adds, a skip subtracts, anything else adds a little.
 * `now` defaults to the clock.
 */
export function tasteSongs(favorites: readonly Song[], history: readonly HistoryEntry[], now = Date.now()): TasteSong[] {
  const out: TasteSong[] = [];
  for (const song of favorites.slice(0, MAX_FAVORITES)) if (song?.id) out.push({ song, weight: 1, part: 'long' });
  for (const e of history.slice(0, MAX_HISTORY)) {
    if (!e?.song?.id) continue;
    const base = e.completed ? PLAY_WEIGHT.completed : isSkippedPlay(e) ? PLAY_WEIGHT.skipped : PLAY_WEIGHT.other;
    const age = Math.max(0, now - (Number.isFinite(e.ts) ? e.ts : now));
    out.push({ song: e.song, weight: base * Math.pow(0.5, age / TASTE_HALF_LIFE_MS), part: age < RECENT_WINDOW_MS ? 'recent' : 'long' });
  }
  return out;
}

/**
 * 9.0.0 — the weighted sum of the taste songs' vectors, with the recent part
 * scaled down when it would hold more than RECENT_SHARE of the weight of a
 * long-term taste of at least MIN_LONG_TERM_MASS. Unit length; null with
 * nothing to go on.
 */
function blendParts(songs: readonly TasteSong[], vectorOf: (song: Song) => Float32Array | null, dims: number): Float32Array | null {
  const long = new Float32Array(dims);
  const recent = new Float32Array(dims);
  let longMass = 0;
  let recentMass = 0;
  for (const { song, weight, part } of songs) {
    const v = vectorOf(song);
    if (!v || v.length !== dims) continue;
    const sum = part === 'recent' ? recent : long;
    for (let i = 0; i < dims; i++) sum[i] += v[i] * weight;
    if (part === 'recent') recentMass += Math.abs(weight);
    else longMass += Math.abs(weight);
  }
  const capped = longMass >= MIN_LONG_TERM_MASS && recentMass > 0 && recentMass / (longMass + recentMass) > RECENT_SHARE;
  const scale = capped ? (RECENT_SHARE / (1 - RECENT_SHARE)) * (longMass / recentMass) : 1;
  for (let i = 0; i < dims; i++) long[i] += recent[i] * scale;
  return unit(long);
}

/** The listener's taste in the on-device space: a unit vector, or null with nothing to go on. */
export function tasteVector(favorites: readonly Song[], history: readonly HistoryEntry[], now = Date.now()): Float32Array | null {
  const vectors = new Map<string, Float32Array | null>();
  const vectorOf = (song: Song): Float32Array | null => {
    if (!vectors.has(song.id)) vectors.set(song.id, songVector(song));
    return vectors.get(song.id) ?? null;
  };
  return blendParts(tasteSongs(favorites, history, now), vectorOf, VECTOR_DIM);
}

/**
 * The listener's taste in a learned embedding space, from the vectors the
 * device already holds (`lookup` is synchronous and never fetches). Null
 * unless at least MIN_EMBEDDED_TASTE_SONGS distinct taste songs have one, or
 * when their dimensions disagree. Never combined with the on-device space.
 */
export function embeddingTasteVector(
  favorites: readonly Song[],
  history: readonly HistoryEntry[],
  lookup: (id: string) => Float32Array | null,
  now = Date.now(),
): Float32Array | null {
  let dims = 0;
  const seen = new Set<string>();
  const cached = new Map<string, Float32Array | null>();
  const vectorOf = (song: Song): Float32Array | null => {
    if (cached.has(song.id)) return cached.get(song.id) ?? null;
    let v: Float32Array | null;
    try {
      v = lookup(song.id);
    } catch {
      v = null;
    }
    cached.set(song.id, v && v.length ? v : null);
    return v && v.length ? v : null;
  };
  const songs = tasteSongs(favorites, history, now);
  for (const { song } of songs) {
    const v = vectorOf(song);
    if (!v) continue;
    if (!dims) dims = v.length;
    if (v.length !== dims) return null;
    seen.add(song.id);
  }
  return dims && seen.size >= MIN_EMBEDDED_TASTE_SONGS ? blendParts(songs, vectorOf, dims) : null;
}
