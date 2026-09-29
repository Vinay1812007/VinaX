import type { Song } from '@/types';
import { parseMusicIntent, words, type IntentMood } from './musicIntent';

/**
 * 8.2.0 — on-device vectors: always available, no network.
 *
 * A deterministic feature-hashing embedding in its OWN space (LOCAL_SPACE,
 * LOCAL_DIM numbers). Songs hash their artists, album, language, genre,
 * mood, vibe, energy band and decade; free text hashes the same typed
 * features it can recognise (via musicIntent) plus its plain words, so
 * "sad telugu songs" lands near Telugu songs tagged melancholy.
 *
 * These vectors are NEVER comparable with server-model vectors
 * (embeddings.ts): compare local with local only.
 */

export const LOCAL_DIM = 128;
export const LOCAL_SPACE = `local-hash-${LOCAL_DIM}`;

/** Feature weights: what a match on each kind of feature is worth. */
const W = { lang: 1.2, mood: 1.0, energy: 0.8, genre: 0.8, vibe: 0.6, decade: 0.5, artist: 1.0, album: 0.5, word: 0.35 } as const;

/** 32-bit FNV-1a. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function add(v: Float32Array, feature: string, weight: number): void {
  const h = hash(feature);
  // One bit of the hash picks the sign, so unrelated collisions tend to cancel.
  v[h % LOCAL_DIM] += h & 0x80000000 ? -weight : weight;
}

function unit(v: Float32Array): Float32Array | null {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) sum += v[i] * v[i];
  if (!(sum > 0)) return null;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < v.length; i += 1) v[i] *= inv;
  return v;
}

const norm = (s: string): string => words(s).join(' ');

/** Title-cue mood for a song that carries none (kept tiny; the classifier fills `mood` when it can). */
const TITLE_MOOD: Array<[IntentMood, RegExp]> = [
  ['devotional', /\b(bhajan|bhakti|devotional|mantra|aarti|swamy|swami|shiva|krishna|ayyappa|hanuman|ganesh\w*)\b/i],
  ['melancholy', /\b(sad|alone|tears|broken|breakup|dard|viraham|lonely|heartbreak|judaai|gham)\b/i],
  ['energetic', /\b(party|dance|dj|mass|beat|remix|dhol|bhangra|thumka|banger)\b/i],
  ['romantic', /\b(love|prema|prem|pyaar|pyar|ishq|kaadhal|dil)\b/i],
  ['chill', /\b(lofi|lo-fi|unplugged|acoustic|lullaby|melody|soft)\b/i],
];

const CLASSIFIED_MOOD: Record<string, IntentMood> = { romantic: 'romantic', energetic: 'energetic', chill: 'chill', melancholy: 'melancholy', devotional: 'devotional' };

function songMood(song: Song): IntentMood | null {
  const m = song.mood ? CLASSIFIED_MOOD[song.mood.toLowerCase()] : undefined;
  if (m) return m;
  for (const [mood, re] of TITLE_MOOD) if (re.test(song.title)) return mood;
  return null;
}

function decadeOf(year: string | null | undefined): number | null {
  const y = year ? Number(String(year).slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1900 ? Math.floor(y / 10) * 10 : null;
}

const cache = new Map<string, Float32Array | null>();
const CACHE_CAP = 4000;

/** On-device vector for a song (LOCAL_SPACE). Null only for a song with no usable metadata. */
export function localSongVector(song: Song): Float32Array | null {
  // Metadata can arrive later (a classified mood, a measured energy): it is part of the key.
  const key = `${song.id}|${song.mood ?? ''}|${song.energy ?? ''}|${song.genre ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = new Float32Array(LOCAL_DIM);
  if (song.language && song.language !== 'unknown') add(v, `lang:${song.language}`, W.lang);
  const mood = songMood(song);
  if (mood) add(v, `mood:${mood}`, W.mood);
  if (typeof song.energy === 'number') add(v, `energy:${song.energy >= 0.6 ? 'high' : song.energy <= 0.4 ? 'low' : 'mid'}`, W.energy);
  else if (mood === 'energetic') add(v, 'energy:high', W.energy * 0.5);
  else if (mood === 'chill' || mood === 'melancholy') add(v, 'energy:low', W.energy * 0.5);
  for (const g of [song.genre, ...(song.genres ?? [])]) if (g) add(v, `genre:${norm(g)}`, W.genre);
  for (const t of [song.vibe, ...(song.vibes ?? [])]) if (t) add(v, `vibe:${norm(t)}`, W.vibe);
  const decade = decadeOf(song.year);
  if (decade) add(v, `decade:${decade}`, W.decade);
  for (const a of (song.artists ?? []).slice(0, 4)) {
    const name = norm(a.name ?? '');
    if (!name) continue;
    add(v, `artist:${name}`, W.artist);
    for (const w of name.split(' ')) if (w.length > 2) add(v, `word:${w}`, W.word);
  }
  const album = song.album?.name ? norm(song.album.name) : '';
  if (album) {
    add(v, `album:${album}`, W.album);
    for (const w of album.split(' ')) if (w.length > 2) add(v, `word:${w}`, W.word * 0.6);
  }
  const out = unit(v);
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, out);
  return out;
}

/** On-device vector for free text (LOCAL_SPACE). Null when the text holds nothing to hash. */
export function localTextVector(text: string): Float32Array | null {
  const intent = parseMusicIntent(text);
  const v = new Float32Array(LOCAL_DIM);
  for (const l of intent.languages) add(v, `lang:${l}`, W.lang);
  for (const m of intent.moods) add(v, `mood:${m}`, W.mood);
  if (intent.energy) add(v, `energy:${intent.energy}`, W.energy);
  if (intent.decade) add(v, `decade:${intent.decade}`, W.decade);
  const kw = intent.keywords;
  for (const w of kw) {
    if (w.length > 2) add(v, `word:${w}`, W.word);
    add(v, `artist:${w}`, W.artist * 0.6);
    add(v, `genre:${w}`, W.genre * 0.6);
    add(v, `vibe:${w}`, W.vibe * 0.6);
  }
  // Two-word names ("sid sriram", "anirudh ravichander").
  for (let i = 0; i + 1 < kw.length; i += 1) add(v, `artist:${kw[i]} ${kw[i + 1]}`, W.artist);
  return unit(v);
}

/** Test hook. */
export function resetLocalVectorCache(): void {
  cache.clear();
}
