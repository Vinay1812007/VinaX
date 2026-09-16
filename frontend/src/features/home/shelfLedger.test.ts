import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { claimShelf, beginBlock, resetShelfLedger, setShelfBlockOrder } from './shelfLedger';

const s = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: '', artists: [], album: null, images: [], audio: [], duration: 1, language: null, year: null, explicit: false, hasLyrics: false, playCount: null });
const ids = (list: Song[]) => list.map((x) => x.id);

beforeEach(() => {
  resetShelfLedger();
  setShelfBlockOrder(['quick', 'personal', 'discovery']);
});

describe('shelf ledger', () => {
  it('a later shelf drops songs an earlier shelf already showed, in display order', () => {
    expect(ids(claimShelf('personal', 0, [s('a'), s('b')]))).toEqual(['a', 'b']);
    expect(ids(claimShelf('personal', 1, [s('b'), s('c')]))).toEqual(['c']);
    expect(ids(claimShelf('discovery', 0, [s('a'), s('c'), s('d')]))).toEqual(['d']);
  });

  it('an earlier block is never filtered by a later one, whatever the mount order', () => {
    // Discovery mounts first (e.g. cached data), then Personal above it.
    expect(ids(claimShelf('discovery', 0, [s('x'), s('y')]))).toEqual(['x', 'y']);
    expect(ids(claimShelf('personal', 0, [s('x'), s('z')]))).toEqual(['x', 'z']);
    // Discovery re-renders and now yields to Personal.
    beginBlock('discovery');
    expect(ids(claimShelf('discovery', 0, [s('x'), s('y')]))).toEqual(['y']);
  });

  it('re-rendering a block replaces its claims instead of stacking them', () => {
    claimShelf('personal', 0, [s('a')]);
    beginBlock('personal');
    expect(ids(claimShelf('personal', 0, [s('a'), s('b')]))).toEqual(['a', 'b']);
    beginBlock('personal');
    expect(ids(claimShelf('personal', 0, [s('a')]))).toEqual(['a']);
    // The old seq-1 claim from a previous render is gone, so discovery sees 'b' again.
    expect(ids(claimShelf('discovery', 0, [s('b')]))).toEqual(['b']);
  });

  it('dedupes within a single shelf too', () => {
    expect(ids(claimShelf('quick', 0, [s('a'), s('a'), s('b')]))).toEqual(['a', 'b']);
  });
});
