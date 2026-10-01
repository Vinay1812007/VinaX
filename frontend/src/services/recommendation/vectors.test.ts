import { describe, expect, it } from 'vitest';
import { makePlay, makeSong } from '@/__fixtures__/songs';
import { dot, embeddingTasteVector, songVector, tasteVector, TASTE_HALF_LIFE_MS, VECTOR_DIM } from './vectors';

/** 8.2.0 — the on-device taste vectors: deterministic, unit length, and about what they claim. */
const NOW = 1_800_000_000_000;
const album = (id: string) => ({ id, name: `Album ${id}` });
const length = (v: Float32Array | null) => Math.sqrt(dot(v, v));

describe('songVector', () => {
  it('is a deterministic unit vector of the fixed dimension', () => {
    const s = makeSong('a', { artist: 'Sid Sriram', album: album('x'), genre: 'film', mood: 'romantic' });
    const v = songVector(s)!;
    expect(v).toHaveLength(VECTOR_DIM);
    expect(length(v)).toBeCloseTo(1, 5);
    expect([...songVector(s)!]).toEqual([...v]);
  });

  it('puts songs that share artist and album closer than songs that share only a language', () => {
    const seed = makeSong('s', { artist: 'Sid Sriram', album: album('x'), genre: 'film' });
    const sibling = makeSong('t', { artist: 'Sid Sriram', album: album('x'), genre: 'film' });
    const stranger = makeSong('u', { artist: 'Someone Else', album: album('y'), genre: 'rock', year: '1994' });
    expect(dot(songVector(seed), songVector(sibling))).toBeGreaterThan(0.9);
    expect(dot(songVector(seed), songVector(stranger))).toBeLessThan(0.3);
  });

  it('never throws on a malformed record', () => {
    expect(() => songVector({ ...makeSong('bad'), artists: undefined as never, language: null })).not.toThrow();
  });
});

describe('tasteVector', () => {
  const loved = makeSong('l', { artist: 'Sid Sriram', album: album('x') });
  const fitting = makeSong('f', { artist: 'Sid Sriram', album: album('x') });
  const other = makeSong('o', { artist: 'Anirudh', album: album('z') });

  it('is null with nothing to go on', () => {
    expect(tasteVector([], [], NOW)).toBeNull();
  });

  it('leans toward favourites and finished plays', () => {
    const taste = tasteVector([loved], [makePlay(other, NOW - 60_000, { completed: false })], NOW);
    expect(dot(songVector(fitting), taste)).toBeGreaterThan(dot(songVector(other), taste));
  });

  it('subtracts skips', () => {
    const withSkip = tasteVector([loved], [makePlay(other, NOW - 60_000, { completed: false, skipped: true })], NOW);
    const without = tasteVector([loved], [], NOW);
    expect(dot(songVector(other), withSkip)).toBeLessThan(dot(songVector(other), without) + 1e-9);
  });

  it('lets old plays fade: a recent run of one artist outweighs an older run of another', () => {
    const history = [makePlay(other, NOW - 3_600_000), makePlay(fitting, NOW - 4 * TASTE_HALF_LIFE_MS)];
    const taste = tasteVector([], history, NOW);
    expect(dot(songVector(other), taste)).toBeGreaterThan(dot(songVector(fitting), taste));
  });
});

describe('tasteVector — long-term and recent taste (9.0.0)', () => {
  const favourites = Array.from({ length: 20 }, (_, i) => makeSong(`fav${i}`, { artist: 'Sid Sriram', album: album(`x${i % 3}`) }));
  const longTermLike = makeSong('ltl', { artist: 'Sid Sriram', album: album('x1') });
  const bingeLike = makeSong('bl', { artist: 'New Voice', album: album('b') });
  // One night: forty finished plays of an artist the listener never played before.
  const binge = Array.from({ length: 40 }, (_, i) => makePlay(makeSong(`b${i}`, { artist: 'New Voice', album: album('b') }), NOW - (i + 1) * 300_000));

  it('one unusual night cannot take a long-standing taste over (recent listening holds at most 40 % of the weight)', () => {
    const taste = tasteVector(favourites, binge, NOW);
    expect(dot(songVector(longTermLike), taste)).toBeGreaterThan(dot(songVector(bingeLike), taste));
    // …but it does register: the binge artist rises against no binge at all.
    expect(dot(songVector(bingeLike), taste)).toBeGreaterThan(dot(songVector(bingeLike), tasteVector(favourites, [], NOW)) + 0.1);
  });

  it('8.x summed everything: the same night outweighed twenty favourites (kept as the reason for the cap)', () => {
    // Recompute the 8.x sum by hand: every taste song's vector times its weight, one vector.
    const sum = new Float32Array(VECTOR_DIM);
    for (const s of favourites) songVector(s)!.forEach((x, i) => { sum[i] += x; });
    for (const p of binge) songVector(p.song)!.forEach((x, i) => { sum[i] += x * Math.pow(0.5, (NOW - p.ts) / TASTE_HALF_LIFE_MS); });
    const n = Math.sqrt(dot(sum, sum));
    const old = Float32Array.from(sum, (x) => x / n);
    expect(dot(songVector(bingeLike), old)).toBeGreaterThan(dot(songVector(longTermLike), old));
  });

  it('a thin long-term taste is not protected: with two favourites, a week of listening is the taste', () => {
    const taste = tasteVector(favourites.slice(0, 2), binge, NOW);
    expect(dot(songVector(bingeLike), taste)).toBeGreaterThan(dot(songVector(longTermLike), taste));
  });
});

describe('embeddingTasteVector', () => {
  const unit = (...xs: number[]) => {
    const n = Math.hypot(...xs);
    return Float32Array.from(xs.map((x) => x / n));
  };

  it('needs at least three taste songs with a cached vector', () => {
    const songs = ['a', 'b', 'c'].map((id) => makeSong(id));
    const lookup = (id: string) => (id === 'a' || id === 'b' ? unit(1, 0) : null);
    expect(embeddingTasteVector(songs, [], lookup, NOW)).toBeNull();
    const all = () => unit(1, 1);
    expect(length(embeddingTasteVector(songs, [], all, NOW))).toBeCloseTo(1, 5);
  });

  it('refuses vectors whose dimensions disagree, and survives a lookup that throws', () => {
    const songs = ['a', 'b', 'c', 'd'].map((id) => makeSong(id));
    expect(embeddingTasteVector(songs, [], (id) => (id === 'd' ? unit(1, 0, 0) : unit(1, 0)), NOW)).toBeNull();
    expect(embeddingTasteVector(songs, [], () => { throw new Error('boom'); }, NOW)).toBeNull();
  });
});
