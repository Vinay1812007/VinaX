import type { Song } from '@/types';
import { activeEmbeddingModel, cosine, embedQueryDetailed, embedSongs, getCachedEmbedding } from './embeddings';
import { localSongVector, localTextVector } from './localVectors';
import { parseMusicIntent, type MusicIntent } from './musicIntent';

/**
 * 8.2.0 — rank songs against a free-text description.
 *
 * Model space first: the query and the songs are embedded by the server
 * model (inside a short leash) and compared by cosine. Songs the model has
 * not embedded yet, or everything when the model is unavailable, are ranked
 * in the on-device space (localVectors.ts). The two spaces are never
 * compared with each other: a song is scored in exactly one of them, and
 * model-space songs lead (their scores are more meaningful).
 *
 * The request's own cues then shape the list: a named language keeps songs
 * in that language on top, a high-energy request lifts songs measured or
 * tagged energetic, and so on.
 */

export interface Scored {
  song: Song;
  score: number;
  space: 'model' | 'local';
}

export interface SemanticRankOpts {
  /** Longest wait for the server model (ms); after it, the on-device space answers. */
  leashMs?: number;
  signal?: AbortSignal;
  /** Parsed intent, when the caller already has it. */
  intent?: MusicIntent;
  /** Songs the server may embed per call (the rest rank on-device). */
  embedLimit?: number;
}

const ENERGETIC = /\b(party|dance|dj|mass|beat|remix|dhol|bhangra|thumka|banger)\b/i;
const CALM = /\b(lofi|lo-fi|unplugged|acoustic|lullaby|melody|soft|slow)\b/i;

/** Cue adjustments on top of similarity (same for both spaces). */
export function intentAdjust(song: Song, intent: MusicIntent): number {
  let adj = 0;
  if (intent.languages.length) adj += song.language && intent.languages.includes(song.language) ? 0.12 : -0.45;
  if (intent.energy === 'high') {
    if (typeof song.energy === 'number') adj += (song.energy - 0.5) * 0.3;
    else if (song.mood === 'energetic' || ENERGETIC.test(song.title)) adj += 0.08;
    else if (song.mood === 'chill' || song.mood === 'melancholy' || CALM.test(song.title)) adj -= 0.08;
  } else if (intent.energy === 'low') {
    if (typeof song.energy === 'number') adj += (0.5 - song.energy) * 0.3;
    else if (song.mood === 'energetic' || ENERGETIC.test(song.title)) adj -= 0.08;
  }
  if (intent.decade && song.year) {
    const y = Number(String(song.year).slice(0, 4));
    if (Number.isFinite(y)) adj += y >= intent.decade && y < intent.decade + 10 ? 0.08 : -0.04;
  }
  return adj;
}

function withLeash<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const done = (v: T | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    signal?.addEventListener('abort', () => done(null), { once: true });
    p.then(done, () => done(null));
  });
}

/** Local-space ranking only (no network). */
export function rankLocally(query: string, songs: Song[], intent: MusicIntent = parseMusicIntent(query)): Scored[] {
  const q = localTextVector(query);
  return songs
    .map((song) => ({ song, score: cosine(q, localSongVector(song)) + intentAdjust(song, intent), space: 'local' as const }))
    .sort((a, b) => b.score - a.score);
}

/** Rank `songs` against `query` — model space where it can, on-device otherwise. Never throws. */
export async function semanticRank(query: string, songs: Song[], opts: SemanticRankOpts = {}): Promise<Scored[]> {
  const intent = opts.intent ?? parseMusicIntent(query);
  const unique: Song[] = [];
  const seen = new Set<string>();
  for (const s of songs) {
    if (s && s.id && !seen.has(s.id)) {
      seen.add(s.id);
      unique.push(s);
    }
  }
  if (!unique.length) return [];
  const leash = opts.leashMs ?? 4500;
  // withLeash never rejects: a failed or slow engine reads as null.
  const [q] = await Promise.all([
    withLeash(embedQueryDetailed(query, opts.signal), leash, opts.signal),
    withLeash(embedSongs(unique.slice(0, opts.embedLimit ?? 128)), leash, opts.signal),
  ]);
  // The query vector is only usable in the space the song cache serves now.
  const modelQuery = q && q.model === activeEmbeddingModel() ? q.vector : null;
  const local = localTextVector(query);
  const scored: Scored[] = unique.map((song) => {
    const mv = modelQuery ? getCachedEmbedding(song.id) : null;
    if (modelQuery && mv && mv.length === modelQuery.length) {
      return { song, score: cosine(modelQuery, mv) + intentAdjust(song, intent), space: 'model' };
    }
    return { song, score: cosine(local, localSongVector(song)) + intentAdjust(song, intent), space: 'local' };
  });
  // A named language outranks everything; then model-space songs (comparable
  // among themselves) lead on-device ones; score orders within each group.
  const langOk = (s: Song): number => (!intent.languages.length || (s.language && intent.languages.includes(s.language)) ? 1 : 0);
  return scored.sort((a, b) => langOk(b.song) - langOk(a.song) || (a.space === b.space ? b.score - a.score : a.space === 'model' ? -1 : 1));
}
