import { afterEach, describe, expect, it } from 'vitest';
import { setSearchSynonyms } from '@/services/search/synonyms';
import { boundedLevenshtein, candidatePool, COMMON_NAMES, didYouMean, DYM_MAX_CANDIDATES } from './didYouMean';

describe('boundedLevenshtein', () => {
  it('measures small edits and gives up early past the cap', () => {
    expect(boundedLevenshtein('kesariya', 'kesariya')).toBe(0);
    expect(boundedLevenshtein('kesariya', 'kesarya')).toBe(1);
    expect(boundedLevenshtein('arijit', 'arjit')).toBe(1);
    expect(boundedLevenshtein('pushpa', 'pushpaa')).toBe(1);
    expect(boundedLevenshtein('tum', 'kesariya')).toBe(3);
    expect(boundedLevenshtein('abcdefgh', 'hgfedcba')).toBe(3);
  });
});

describe('candidatePool', () => {
  it('dedupes case-insensitively, drops the query itself and caps the set', () => {
    const many = Array.from({ length: 300 }, (_, i) => `song ${i}`);
    const pool = candidatePool('Arijit Singh', [['arijit singh', 'Kesariya', ' kesariya '], many]);
    expect(pool.slice(0, 2)).toEqual(['Kesariya', 'song 0']);
    expect(pool.length).toBe(DYM_MAX_CANDIDATES);
  });
});

describe('didYouMean', () => {
  afterEach(() => setSearchSynonyms(null));

  it('suggests the nearest whole candidate, keeping its casing', () => {
    expect(didYouMean('arijit sing', ['Kesariya', 'Arijit Singh'])).toBe('Arijit Singh');
    expect(didYouMean('kesarya', ['Kesariya'])).toBe('Kesariya');
  });

  it('prefers a closer candidate', () => {
    expect(didYouMean('pushpa 2', ['Pushpa 2 The Rule', 'Pushpa 3'])).toBe('Pushpa 3');
  });

  it('fixes a misspelt word inside a longer query', () => {
    expect(didYouMean('samajavaragamna lofi', ['Samajavaragamana'])).toBe('Samajavaragamana lofi');
  });

  it('never touches short words or suggests the same query back', () => {
    expect(didYouMean('tum', ['tam', 'tim'])).toBeNull();
    expect(didYouMean('Kesariya', ['kesariya'])).toBeNull();
    expect(didYouMean('zzzzzzzz', ['Kesariya', 'Pushpa'])).toBeNull();
    expect(didYouMean('   ', ['Kesariya'])).toBeNull();
  });

  it('uses an admin synonym before any spelling guess', () => {
    setSearchSynonyms({ arr: 'A. R. Rahman' });
    expect(didYouMean('arr', ['Arjun'])).toBe('A. R. Rahman');
    expect(didYouMean('arr songs', [])).toBe('A. R. Rahman songs');
  });

  it('finds common artists and films from the built-in list', () => {
    expect(didYouMean('anirudh ravichandr', COMMON_NAMES)).toBe('Anirudh Ravichander');
    expect(didYouMean('bahubali', COMMON_NAMES)).toBe('Baahubali');
  });

  it('stays instant on a full 200-candidate pool', () => {
    const pool = candidatePool('x', [COMMON_NAMES, Array.from({ length: 200 }, (_, i) => `candidate number ${i}`)]);
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) didYouMean('rangasthalm songs', pool);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
