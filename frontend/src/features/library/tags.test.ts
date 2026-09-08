import { describe, it, expect } from 'vitest';
import { allTags, matchesTags, normalizeTag, normalizeTags, TAG_MAX_LENGTH, TAG_MAX_PER_COLLECTION } from './tags';

describe('normalizeTags (v5.19.0)', () => {
  it('splits a comma-separated string, lower-cases, trims and de-duplicates', () => {
    expect(normalizeTags(' Chill, DRIVE ,, chill , #Telugu ')).toEqual(['chill', 'drive', 'telugu']);
  });

  it('accepts an array and ignores non-string / empty items', () => {
    const dirty = ['Road Trip', '', '  ', 42, null, 'road  trip', 'Late night'] as unknown as string[];
    expect(normalizeTags(dirty)).toEqual(['road trip', 'late night']);
  });

  it('caps the count and the length of each tag', () => {
    const many = Array.from({ length: TAG_MAX_PER_COLLECTION + 3 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(TAG_MAX_PER_COLLECTION);
    expect(normalizeTags(many)[0]).toBe('t0');
    const long = 'x'.repeat(TAG_MAX_LENGTH + 10);
    expect(normalizeTag(long)).toHaveLength(TAG_MAX_LENGTH);
    // A cut that lands on a space is trimmed rather than left dangling.
    expect(normalizeTag(`${'a'.repeat(TAG_MAX_LENGTH - 1)} bcd`)).toBe('a'.repeat(TAG_MAX_LENGTH - 1));
  });

  it('returns an empty list for nothing useful', () => {
    expect(normalizeTags('')).toEqual([]);
    expect(normalizeTags(', , #')).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });
});

describe('allTags / matchesTags', () => {
  const cols = [{ tags: ['drive', 'chill'] }, { tags: ['chill', 'sad'] }, {}, { tags: [] }];

  it('lists every tag in use once, alphabetically', () => {
    expect(allTags(cols)).toEqual(['chill', 'drive', 'sad']);
    expect(allTags([])).toEqual([]);
  });

  it('passes everything with no selection and matches ANY selected tag otherwise', () => {
    expect(cols.map((c) => matchesTags(c, []))).toEqual([true, true, true, true]);
    expect(cols.map((c) => matchesTags(c, ['drive']))).toEqual([true, false, false, false]);
    expect(cols.map((c) => matchesTags(c, ['drive', 'sad']))).toEqual([true, true, false, false]);
  });
});
