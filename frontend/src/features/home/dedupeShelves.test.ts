import { describe, it, expect } from 'vitest';
import { createShelfDeduper, dedupeShelves } from './dedupeShelves';
import type { Song } from '../../types';

const s = (id: string): Song => ({
  kind: 'song',
  id,
  title: id,
  subtitle: '',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: 0,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

describe('createShelfDeduper', () => {
  it('drops songs already seen in an earlier call', () => {
    const d = createShelfDeduper();
    expect(d([s('a'), s('b')]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(d([s('b'), s('c')]).map((x) => x.id)).toEqual(['c']);
  });

  it('removes intra-shelf duplicates too', () => {
    const d = createShelfDeduper();
    expect(d([s('a'), s('a'), s('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('dedupeShelves', () => {
  it('keeps the first occurrence across shelves, in order', () => {
    const out = dedupeShelves([
      [s('a'), s('b')],
      [s('b'), s('c')],
      [s('a'), s('d')],
    ]);
    expect(out.map((sh) => sh.map((x) => x.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});
