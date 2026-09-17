import { describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { isFavoriteIn } from './favIndex';

describe('isFavoriteIn', () => {
  it('answers membership and follows a replaced favourites array', () => {
    const first = [makeSong('a'), makeSong('b')];
    expect(isFavoriteIn(first, 'a')).toBe(true);
    expect(isFavoriteIn(first, 'z')).toBe(false);
    const second = first.filter((s) => s.id !== 'a');
    expect(isFavoriteIn(second, 'a')).toBe(false);
    expect(isFavoriteIn(second, 'b')).toBe(true);
    // Going back to an earlier snapshot is still correct.
    expect(isFavoriteIn(first, 'a')).toBe(true);
  });
});
