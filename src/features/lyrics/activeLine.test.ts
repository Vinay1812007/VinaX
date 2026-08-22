// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { activeLyricIndex } from './activeLine';

const lines = [
  { t: 10, text: 'one' },
  { t: 14, text: 'two' },
  { t: 20, text: 'three' },
];

describe('activeLyricIndex — the one index every lyric surface shares', () => {
  it('is -1 before the first line, then the last line that has started', () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 9.5)).toBe(-1);
    expect(activeLyricIndex(lines, 10)).toBe(0);
    expect(activeLyricIndex(lines, 13.9)).toBe(1); // 0.2s lookahead reaches 14
    expect(activeLyricIndex(lines, 15)).toBe(1);
    expect(activeLyricIndex(lines, 99)).toBe(2);
  });

  it('lookahead hides the ~250ms timeupdate cadence', () => {
    expect(activeLyricIndex(lines, 9.81)).toBe(0);
    expect(activeLyricIndex(lines, 9.79)).toBe(-1);
  });

  it('offset sign follows the store: positive shows lines LATER', () => {
    expect(activeLyricIndex(lines, 10, 2)).toBe(-1); // delayed — not lit yet
    expect(activeLyricIndex(lines, 12, 2)).toBe(0);
    expect(activeLyricIndex(lines, 13, -1.5)).toBe(1); // negative — earlier
  });

  it('handles an empty list', () => {
    expect(activeLyricIndex([], 42)).toBe(-1);
  });
});
