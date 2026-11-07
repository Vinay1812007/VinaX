import { describe, expect, it } from 'vitest';
import { resultCountLine } from './resultCount';

describe('resultCountLine', () => {
  it('formats the catalogue count', () => {
    expect(resultCountLine(5273)).toBe('5,273 results');
    expect(resultCountLine(1)).toBe('1 result');
  });
  it('says nothing without a count', () => {
    expect(resultCountLine(null)).toBeNull();
    expect(resultCountLine(0)).toBeNull();
  });
});
