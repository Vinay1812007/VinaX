/**
 * 11.7.0 — the listener's own taste, applied where an AI surface used to rank
 * by the request alone, plus a bounded random draw so the same request does not
 * crown the same winners every time.
 *
 * Before 11.7 the AI Playlist's catalogue fill was ordered by `semanticRank`
 * — cosine similarity to the PROMPT, nothing else. Two listeners typing
 * "telugu sad songs" got the same list, and one listener typing it twice got
 * the same list twice (the pool was the same and the sort is deterministic).
 *
 * `personalOrder` keeps relevance in charge and only reorders inside it:
 *   score' = relevance + TASTE_WEIGHT · taste(song) + β · Gumbel noise
 * where β is a fraction of the spread of the top window's relevance, so a
 * strong-but-not-top song can win a round while a weak match never jumps a
 * strong one. Adding Gumbel noise and sorting is an exact draw without
 * replacement from softmax(score / β) — sampling, not shuffling.
 *
 * Device-local; nothing here leaves the device.
 */
import type { Song } from '@/types';
import { loadProfile } from '@/services/personalization/storage';
import type { TasteProfile } from '@/services/personalization/profile';
import { MAX_AFFINITY } from '@/services/personalization/eventWeights';
import { useLibraryStore } from '@/store/libraryStore';

/** How far taste may move a song, in relevance units (a language match is 0.12). */
export const TASTE_WEIGHT = 0.1;
/** Noise scale as a fraction of the top window's relevance spread. */
const NOISE_SHARE = 0.35;

/** −1 … 1: how much this listener's own history says they like a song's artists. */
export type TasteLens = (song: Song) => number;

const artistKeys = (song: Song): Array<{ id?: string; name: string }> =>
  (song.artists ?? []).map((a) => ({ id: a.id || undefined, name: (a.name ?? '').trim().toLowerCase() })).filter((a) => a.id || a.name);

/**
 * Build the lens once per ranking. Artist affinity is the decayed score the
 * profile already keeps (plays, completions, skips); an artist the listener
 * skips more than they finish counts against; a favourite's artist counts for.
 */
export function tasteLens(
  profile: TasteProfile = loadProfile(),
  favorites: readonly Song[] = useLibraryStore.getState().favorites,
): TasteLens {
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const [key, a] of Object.entries(profile.artists ?? {})) {
    const liked = Math.min(1, Math.max(0, a.score) / (MAX_AFFINITY / 3));
    const avoided = a.skips >= 3 && a.skips > a.completes ? Math.min(1, (a.skips - a.completes) / 6) : 0;
    const v = liked - avoided;
    if (!v) continue;
    if (key.startsWith('name:')) byName.set(key.slice(5), v);
    else byId.set(key, v);
    const name = a.name?.trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, v);
  }
  const favArtists = new Set<string>();
  for (const s of favorites) {
    for (const a of artistKeys(s)) {
      if (a.id) favArtists.add(a.id);
      if (a.name) favArtists.add(`name:${a.name}`);
    }
  }
  return (song) => {
    let best = 0;
    for (const a of artistKeys(song)) {
      const v = (a.id ? byId.get(a.id) : undefined) ?? byName.get(a.name) ?? 0;
      const fav = (a.id && favArtists.has(a.id)) || favArtists.has(`name:${a.name}`) ? 0.3 : 0;
      const total = Math.max(-1, Math.min(1, v + fav));
      // The strongest signal wins either way: one loved artist on a duet is enough,
      // and so is one the listener keeps skipping.
      if (Math.abs(total) > Math.abs(best)) best = total;
    }
    return best;
  };
}

/** A small seeded generator (mulberry32), so tests can pin a draw. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gumbel = (rand: () => number): number => {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rand()));
  return -Math.log(-Math.log(u));
};

export interface PersonalOrderOpts<T> {
  /** How many items the caller will take — sets the window the noise is scaled to. */
  take: number;
  lens?: TasteLens;
  /** Defaults to Math.random. */
  random?: () => number;
  /**
   * Items with different tiers never swap (e.g. model-space before on-device
   * scores, in-language before out). Consecutive runs of one tier are reordered
   * among themselves only.
   */
  tier?: (item: T) => string;
  /** 0 turns the draw off (taste only). */
  noiseShare?: number;
}

/**
 * Reorder a relevance-sorted list by relevance + taste + a bounded draw.
 * Never drops or duplicates an item.
 */
export function personalOrder<T extends { song: Song; score: number }>(ranked: readonly T[], opts: PersonalOrderOpts<T>): T[] {
  if (ranked.length < 2) return [...ranked];
  const random = opts.random ?? Math.random;
  const lens = opts.lens;
  const share = opts.noiseShare ?? NOISE_SHARE;
  const out: T[] = [];
  let i = 0;
  while (i < ranked.length) {
    const tier = opts.tier?.(ranked[i]) ?? '';
    let j = i + 1;
    while (j < ranked.length && (opts.tier?.(ranked[j]) ?? '') === tier) j += 1;
    const run = ranked.slice(i, j);
    // Noise is scaled to how close the contenders are: the spread between the
    // best item and the one just past what the caller will take.
    const scores = run.map((x) => x.score).sort((a, b) => b - a);
    const edge = scores[Math.min(scores.length - 1, Math.max(1, opts.take * 2))];
    const beta = Math.max(0, (scores[0] - edge) * share);
    const keyed = run.map((item) => ({
      item,
      key: item.score + (lens ? TASTE_WEIGHT * lens(item.song) : 0) + (beta > 0 ? beta * gumbel(random) : 0),
    }));
    keyed.sort((a, b) => b.key - a.key);
    out.push(...keyed.map((k) => k.item));
    i = j;
  }
  return out;
}
