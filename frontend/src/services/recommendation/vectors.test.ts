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
