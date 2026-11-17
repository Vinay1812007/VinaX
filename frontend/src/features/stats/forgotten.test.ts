// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FORGOTTEN_KEY, forgetPlays, isForgotten, readForgotten, restoreForgotten } from './forgotten';

describe('forgotten plays', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers cleared stretches and matches plays inside them', () => {
    forgetPlays({ from: 100, to: 200 });
    forgetPlays({ from: 500, to: 600, songId: 's1' });
    const r = readForgotten();
    expect(isForgotten(r, 'any', 150)).toBe(true);
    expect(isForgotten(r, 'any', 250)).toBe(false);
    expect(isForgotten(r, 's1', 550)).toBe(true);
    expect(isForgotten(r, 's2', 550)).toBe(false);
  });

  it('a clear-all replaces earlier notes, and Undo puts them back', () => {
    forgetPlays({ from: 100, to: 200 });
    const before = forgetPlays({ from: 0, to: 1_000 });
    expect(readForgotten()).toEqual([{ from: 0, to: 1_000 }]);
    restoreForgotten(before);
    expect(readForgotten()).toEqual([{ from: 100, to: 200 }]);
  });

  it('a note that ends earlier keeps the later notes it does not cover', () => {
    forgetPlays({ from: 500, to: 600, songId: 's1' });
    forgetPlays({ from: 50, to: 80 });
    forgetPlays({ from: 0, to: 300 });
    expect(readForgotten()).toEqual([{ from: 500, to: 600, songId: 's1' }, { from: 0, to: 300 }]);
    // A one-song note never swallows a note for every song.
    forgetPlays({ from: 0, to: 1_000, songId: 's2' });
    expect(readForgotten()).toHaveLength(3);
  });

  it('survives junk in storage', () => {
    window.localStorage.setItem(FORGOTTEN_KEY, JSON.stringify([{ from: 'x' }, null, { from: 1, to: 2 }]));
    expect(readForgotten()).toEqual([{ from: 1, to: 2 }]);
    window.localStorage.setItem(FORGOTTEN_KEY, '{oops');
    expect(readForgotten()).toEqual([]);
  });
});
